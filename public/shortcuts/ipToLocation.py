import datetime
import sys
import socket
import struct
from flask import json
from scapy.all import get_if_addr, sniff, IP, conf, ICMP, sr1, traceroute, TCP
import csv
import time
from concurrent.futures import ThreadPoolExecutor
import signal
import os
import atexit
import dotenv

dotenv.load_dotenv()
executor = ThreadPoolExecutor(max_workers=10)
avgTTC = [0, 0]  # TTC , counter
geo_cache = {}  # cache for ip's and their info
ping_cache = {}  # cache for ip's and their ping
trace_cache = {}  # cache for ip's and their traceroute info
scan_cache = {}
## sets to track pending background tasks to avoid duplicates
pending_pings = set()  # track IPs currently being pinged
pending_traces = set()
pending_scans = set()

my_ip = get_if_addr(conf.iface)  # used ip on device

is_dev = "--dev" in sys.argv

log_file = None
log_dirty = False
last_log_write = 0.0

## GLOBALS
MAX_TRACE_JUMPS = 10
LOG_WRITE_INTERVAL_SEC = 5.0



# Load CSV into memory at startup
ip_db = []
with open(os.getenv("CSV_PATH"), mode="r", newline="") as file:
    reader = csv.reader(file)
    next(reader, None)
    for row in reader:
        try:
            # CSV schema: ... country (3), province (4), latitude (6), longitude (7)
            ip_db.append(
                (
                    int(row[0]),
                    int(row[1]),
                    float(row[6]),
                    float(row[7]),
                    str(row[3]),
                    str(row[4]),
                    str(row[2]),
                )
            )
        except (ValueError, IndexError):
            continue
print(json.dumps({"status": "ready", "length": len(ip_db)}), flush=True)



def binary_search(arr, x):
    low = 0
    high = len(arr) - 1

    while low <= high:
        mid = low + (high - low) // 2

        if arr[mid][0] <= x <= arr[mid][1]:  # x falls within the range
            return mid
        elif arr[mid][0] < x:
            low = mid + 1
        else:
            high = mid - 1

    return -1


########################################
#             LOGS                    #
########################################


def create_log_file(base_dir: str) -> str:
    os.makedirs(base_dir, exist_ok=True)  # creates the directory if it doesn't exist
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    filepath = os.path.join(base_dir, f"log_{timestamp}.json")
    open(filepath, "w").close()
    return filepath


def write_log_snapshot(filepath: str, entry: dict) -> None:
    # Rewrite full JSON snapshot so log files stay valid JSON for front-end fetch/json parsing.
    with open(filepath, "w") as f:
        f.write(json.dumps(entry))


def persist_log_if_needed(force: bool = False) -> None:
    global last_log_write
    global log_dirty
    if not is_dev or not log_file:
        return

    now = time.time()
    if not force and (not log_dirty or (now - last_log_write) < LOG_WRITE_INTERVAL_SEC):
        return

    payload = {"geo_cache": list(geo_cache.values())}
    write_log_snapshot(log_file, payload)
    last_log_write = now
    log_dirty = False


# saves the average time to search for the CSV file
def saveAvgTime(startTime, endTime):
    """
    Find the average time for complete for memory operations

    Args:
        startTime: start time of the operation
        endTime: end time of the operation
    """
    if avgTTC[1] == 0:
        avgTTC[0] = (endTime - startTime).total_seconds()
        avgTTC[1] = 1
    else:
        avgTTC[0] = (
            (avgTTC[0] * avgTTC[1]) + (endTime - startTime).total_seconds()
        ) / (avgTTC[1] + 1)  # avg calculation
        avgTTC[1] += 1


# converts the decimal ip to the correct digit format
def ip_to_int(ip):
    try:
        return struct.unpack("!I", socket.inet_aton(ip))[0]
    except Exception:
        return None


def get_geolocation_CSV(ip):
    """
    gets the geolocation data from the memory database

    Args:
        ip: The destination IP address in dotted-decimal format (e.g. '8.8.8.8')

    Returns:
        JSON format of {lat, lon, ip, lookupTime}
        or
        None
    """
    startTime = datetime.datetime.now()

    ip_int = ip_to_int(ip)
    if ip_int is None:
        return
    location = {}
    endTime = datetime.datetime.now()
    index = binary_search(ip_db, ip_int)
    saveAvgTime(startTime, endTime)
    if is_dev:
        location = {
            "lat": ip_db[index][2],
            "lon": ip_db[index][3],
            "ip": ip,
            "locLookupTime": avgTTC,
            "country": ip_db[index][4],
            "province": ip_db[index][5],
            "region": ip_db[index][6],
        }
    else:
        location = {"lat": ip_db[index][2], "lon": ip_db[index][3]}
    geo_cache[ip] = location
    return location


def guess_os(packet):
    ttl = packet[IP].ttl
    if ttl <= 64:
        return "Linux/Mac"
    elif ttl <= 128:
        return "Windows"
    else:
        return "Unknown"
    

########################################
#             PING                   #
########################################


def get_ping(ip):
    """
    Sends a single ICMP echo request to the given IP and returns the round-trip time.

    Args:
        ip: The destination IP address in dotted-decimal format (e.g. '8.8.8.8')

    Returns:
        Round-trip time in milliseconds rounded to 2 decimal places,
        or None if the host did not respond within the timeout.

    Notes:
        Uses a 2 second timeout. Requires admin/root privileges to send raw ICMP packets.
    """
    start = time.time()
    reply = sr1(IP(dst=ip) / ICMP(), timeout=2, verbose=0)
    if reply:
        return round((time.time() - start) * 1000, 2)
    return None


def ping_and_cache(ip):
    """
    Grabs the ping from get_ping() and caches it, then discards it from the set queue

    Args:
        ip The destination IP address in dotted-decimal format (e.g. '8.8.8.8')

    """
    result = get_ping(ip)
    ping_cache[ip] = result
    pending_pings.discard(ip)


########################################
#             TRACE                   #
########################################


def trace_and_cache(ip):
    """
    Starts a traceroute for a given ip, then appends all of the hops to an array and caches it
    discards from the queue after the call

    Args:
        ip The destination IP address in dotted-decimal format (e.g. '8.8.8.8')

    """
    result, _ = traceroute(ip, maxttl=MAX_TRACE_JUMPS, verbose=0)
    hops = []
    for snd, rcv in result:
        ipInfo = geo_cache.get(rcv.src) or get_geolocation_CSV(rcv.src)
        if is_dev:
            if ipInfo and rcv.src not in scan_cache and rcv.src not in pending_scans:
                pending_scans.add(rcv.src)
                executor.submit(scan_and_cache, rcv.src)
            hops.append(
                {
                    "ttl": snd.ttl,
                    "ip": rcv.src,
                    "rtt": round((rcv.time - snd.sent_time) * 1000, 2),
                    "lon": ipInfo["lon"] if ipInfo else None,
                    "lat": ipInfo["lat"] if ipInfo else None,
                    "country": ipInfo["country"] if ipInfo else None,
                    "province": ipInfo["province"] if ipInfo else None,
                    "ping": ping_cache.get(rcv.src, None) if ipInfo else None,
                    "region": ipInfo["region"] if ipInfo else None,
                    "nmap": scan_cache.get(rcv.src, None) if ipInfo else None,
                    "OS": guess_os(rcv) if ipInfo else None,
                    
                }
            )
        else:
            hops.append(
                {
                    "ttl": snd.ttl,
                    "ip": rcv.src,
                    "rtt": round((rcv.time - snd.sent_time) * 1000, 2),
                    "lon": ipInfo["lon"] if ipInfo else None,
                    "lat": ipInfo["lat"] if ipInfo else None,
                }
            )
    trace_cache[ip] = hops
    pending_traces.discard(ip)


########################################
#             NMAP                    #
########################################


def port_scan(ip: str, ports: list[int]) -> dict:
    """
    Performs a basic TCP SYN scan on the given IP and ports using Scapy.

    Args:
        ip: Target IP address in dotted-decimal format
        ports: List of port numbers to scan

    Returns:
        Dictionary mapping port numbers to their status ('open', 'closed', 'filtered')

    Notes:
        Requires admin/root privileges. Use a small port list to avoid blocking the main thread.
    """
    results = {}
    for port in ports:
        pkt = IP(dst=ip) / TCP(dport=port, flags="S")
        reply = sr1(pkt, timeout=1, verbose=0)

        if reply is None:
            results[port] = "filtered"
        elif reply.haslayer(TCP):
            if reply[TCP].flags == 0x12:  # SYN-ACK
                results[port] = "open"
            elif reply[TCP].flags == 0x14:  # RST-ACK
                results[port] = "closed"

    return results


def scan_and_cache(ip):
    results = port_scan(ip, [80, 443, 22, 21, 8080])
    scan_cache[ip] = results
    pending_scans.discard(ip)




########################################
#             MAIN LOOP                #
########################################
 


def packetSniffer(packet):
    """
    If there is an ip component to the packet, we get both the source and destination, if either is me then we use the other
    we check geo cache to see if that is cached already and if not we find the geolocation and cache it

    multithreaded finding the ping

    multithreaded finding the traceroute

    also get the direction of the packet

    then print everything as json for nodejs to see

    """

    global log_dirty
    if IP in packet:
        src = packet[IP].src
        dst = packet[IP].dst

        external_ip = dst if src == my_ip else src
        direction = "out" if src == my_ip else "in"

        if external_ip not in ["127.0.0.1", my_ip]:
            if external_ip in geo_cache:
                ipInfo = geo_cache[external_ip]
            else:
                ipInfo = get_geolocation_CSV(external_ip)

            # Add this check to prevent NoneType errors
            if ipInfo is None or ipInfo["lat"] == 0 or ipInfo["lon"] == 0:
                return

            # Kick off ping in background if not already cached or pending
            if external_ip not in ping_cache and external_ip not in pending_pings:
                pending_pings.add(external_ip)
                executor.submit(ping_and_cache, external_ip)
            ipInfo["ping"] = ping_cache.get(external_ip, None)

            if external_ip not in trace_cache and external_ip not in pending_traces:
                pending_traces.add(external_ip)
                executor.submit(trace_and_cache, external_ip)

            if external_ip not in scan_cache and external_ip not in pending_scans:
                pending_scans.add(external_ip)
                executor.submit(scan_and_cache, external_ip)


            ipInfo["OperatingSystem"] = guess_os(packet)
            ipInfo["nmap"] = scan_cache.get(external_ip, None)
            ipInfo["trace"] = trace_cache.get(external_ip, None)
            ipInfo["direction"] = direction
            ipInfo["tracedIps"] = len(trace_cache)
            ipInfo["uniqueIPs"] = len(geo_cache)

            log_dirty = True
            persist_log_if_needed()

            print(json.dumps(ipInfo), flush=True)
            sys.stdout.flush()




def on_exit():
    global log_file
    if is_dev:
        if not log_file:
            log_file = create_log_file("logs")
            if sys.platform.startswith("darwin"):
                os.chmod("logs", 0o777)  # set permissions to read/write for everyone
                os.chmod(log_file, 0o777)  # set permissions to read/write for everyone
        persist_log_if_needed(force=True)
    executor.shutdown(wait=False)


def on_signal(sig, frame):
    on_exit()
    sys.exit(0)


if is_dev:
    signal.signal(signal.SIGTERM, on_signal)
    log_file = create_log_file("logs")
    if sys.platform.startswith("darwin"):
        os.chmod("logs", 0o777)  # set permissions to read/write for everyone
        os.chmod(log_file, 0o777)  # set permissions to read/write for everyone
    persist_log_if_needed(force=True)

atexit.register(on_exit)

## constant packet sniff in real time
sniff(prn=packetSniffer, store=0, filter="ip")
