import sys
import json
import csv
import os
import dotenv
import struct, socket
dotenv.load_dotenv()

security_cache = {}
ip_db = []

def ip_to_int(ip):
    try:
        return struct.unpack("!I", socket.inet_aton(ip))[0]
    except Exception:
        return None


def ip_to_info(ip):
    if ip in security_cache:
        return security_cache[ip]
    ip_int = ip_to_int(ip)
    if ip_int is None:
        return
    for start, end, security in ip_db:
        if start <= ip_int <= end:
            sec = {'security': security}
            security_cache[ip] = sec
            return sec
    


# Load CSV once

with open(os.getenv("CSV_IPINFO_PATH"), mode='r', newline='') as file:
    reader = csv.reader(file)
    next(reader, None)
    for row in reader:
        try:
            ip_db.append((int(row[0]), int(row[1]), str(row[13])))
        except (ValueError, IndexError):
            continue


print(json.dumps({"status": "ready"}), flush=True)

for line in sys.stdin:
    try:
        request = json.loads(line.strip())
        fn = request.get("fn")
        args = request.get("args", {})

        if fn == "getSecurityIP":
            ip = args.get("ip", None)
            if ip is not None:
                result = ip_to_info(ip)
                print(json.dumps(result), flush=True)

        # Add more functions here as needed

    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True)