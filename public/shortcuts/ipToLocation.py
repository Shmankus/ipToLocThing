
import datetime
import sys
import socket
import struct
from flask import json
from scapy.all import get_if_addr, sniff, IP, conf, ICMP, sr1, traceroute
import csv
import time
from concurrent.futures import ThreadPoolExecutor
import signal
import os
import atexit
import dotenv
dotenv.load_dotenv()
executor = ThreadPoolExecutor(max_workers=10)
avgTTC = [0,0] # TTC , counter
geo_cache = {} # cache for ip's and their info
ping_cache = {} # cache for ip's and their ping
trace_cache = {} # cache for ip's and their traceroute info
my_ip = get_if_addr(conf.iface) # used ip on device

is_dev = '--dev' in sys.argv
totalPackets = 0

## GLOBALS
MAX_TRACE_JUMPS = 10      


def create_log_file(base_dir: str) -> str:
    os.makedirs(base_dir, exist_ok=True)  # creates the directory if it doesn't exist
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    filepath = os.path.join(base_dir, f"log_{timestamp}.json")
    open(filepath, 'w').close()
    return filepath

def append_to_log(filepath: str, entry: dict) -> None:
    with open(filepath, 'a') as f:
        f.write(json.dumps(entry) +  '\n')
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
        avgTTC[0] = ((avgTTC[0] * avgTTC[1]) + (endTime - startTime).total_seconds()) / (avgTTC[1]+1) # avg calculation
        avgTTC[1]+=1


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

    for start, end, lat, lon in ip_db:
        if start <= ip_int <= end:
            endTime = datetime.datetime.now()
            saveAvgTime(startTime, endTime)
            location = {"lat": lat, "lon": lon, "ip": ip, "locLookupTime": avgTTC}
            geo_cache[ip] = location
            return location


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
    reply = sr1(IP(dst=ip)/ICMP(), timeout=2, verbose=0)
    if reply:
        return round((time.time() - start) * 1000, 2)
    return None

pending_pings = set()  # track IPs currently being pinged

def ping_and_cache(ip):
    """
    Grabs the ping from get_ping() and caches it, then discards it from the set queue

    Args:
        ip The destination IP address in dotted-decimal format (e.g. '8.8.8.8')
    
    """
    result = get_ping(ip)
    ping_cache[ip] = result
    pending_pings.discard(ip)


pending_traces = set()
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
        location = geo_cache.get(rcv.src) or get_geolocation_CSV(rcv.src)
        hops.append({
            "ttl": snd.ttl,
            "ip": rcv.src,
            "rtt": round((rcv.time - snd.sent_time) * 1000, 2),
            "lon": location["lon"] if location else None,
            "lat": location["lat"] if location else None,
        })
    trace_cache[ip] = hops  
    pending_traces.discard(ip)



# helper function that collects the ip from the packet and prints the json for nodejs
def packet_callback(packet):
    """
    If there is an ip component to the packet, we get both the source and destination, if either is me then we use the other
    we check geo cache to see if that is cached already and if not we find the geolocation and cache it

    multithreaded finding the ping

    multithreaded finding the traceroute

    also get the direction of the packet

    then print everything as json for nodejs to see
    
    """
    global totalPackets
    if IP in packet:
            src = packet[IP].src
            dst = packet[IP].dst
            
            external_ip = dst if src == my_ip else src
            direction = "out" if src == my_ip else "in"

            if external_ip not in ['127.0.0.1', my_ip]:
                if external_ip in geo_cache:
                    location = geo_cache[external_ip]
                else:
                    location = get_geolocation_CSV(external_ip)
                    
                
                # Add this check to prevent NoneType errors
                if location is None or location["lat"] == 0 or location["lon"] == 0:
                    return

                # Kick off ping in background if not already cached or pending
                if external_ip not in ping_cache and external_ip not in pending_pings:
                    pending_pings.add(external_ip)
                    executor.submit(ping_and_cache, external_ip)
                location["ping"] = ping_cache.get(external_ip, None)
                
                if external_ip not in trace_cache and external_ip not in pending_traces:
                    pending_traces.add(external_ip)
                    executor.submit(trace_and_cache, external_ip)

                location["trace"] = trace_cache.get(external_ip, None)
                location["direction"] = direction
                location["totalPackets"] = totalPackets
                location["tracedIps"] = len(trace_cache)
                
                totalPackets += 1
                
                print(json.dumps(location))
                sys.stdout.flush()


# Load CSV into memory at startup
ip_db = []
with open(os.getenv("CSV_PATH"), mode='r', newline='') as file:
    reader = csv.reader(file)
    next(reader, None)
    for row in reader:
        try:
            ip_db.append((int(row[0]), int(row[1]), float(row[6]), float(row[7])))
        except (ValueError, IndexError):
            continue
print(json.dumps({"status": "ready", "length": len(ip_db)}), flush=True)

log_file = None

def on_exit():
    if is_dev:
        log_file = create_log_file("logs")
        append_to_log(log_file, {"geo_cache": list(geo_cache.values())})
    executor.shutdown(wait=False)

def on_signal(sig, frame):
    on_exit()
    sys.exit(0)

if is_dev:
    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)

atexit.register(on_exit)

## constant packet sniff in real time
sniff(prn=packet_callback, store=0, filter="ip")

