import sys
import json
import datetime
import csv
import os
import dotenv
import struct, socket
dotenv.load_dotenv()
avgTTC = [0,0] # TTC , counter
security_cache = {}
ip_db = []

# saves the average time to search for the CSV file
def saveAvgTime(startTime, endTime):
    if avgTTC[1] == 0:
        avgTTC[0] = (endTime - startTime).total_seconds()
        avgTTC[1] = 1
    else:
        avgTTC[0] = ((avgTTC[0] * avgTTC[1]) + (endTime - startTime).total_seconds()) / (avgTTC[1]+1)
        avgTTC[1]+=1

# converts the decimal ip to the correct digit format
def ip_to_int(ip):
    try:
        return struct.unpack("!I", socket.inet_aton(ip))[0]
    except Exception:
        return None

# takes an ip and searches the security database for any "dangers"
def ip_to_info(ip):
    startTime = datetime.datetime.now()
    if ip in security_cache:
        return security_cache[ip]
    
    ip_int = ip_to_int(ip)  # convert dotted-decimal -> int
    if ip_int is None:
        return {"security": "not found"  , "secLookupTime" : avgTTC[0]}
    
    for start, end, security in ip_db:
        if start <= ip_int <= end:
            endTime = datetime.datetime.now()
            saveAvgTime(startTime, endTime)
            sec = {"security": security , "secLookupTime" : avgTTC}
            security_cache[ip] = sec
            return sec
    
    endTime = datetime.datetime.now()
    saveAvgTime(startTime, endTime)
    security_cache[ip] = {"security": "N/A" , "secLookupTime" : avgTTC}  # cache the "not found" result
    return {"security": "N/A" , "secLookupTime" : avgTTC}  # only after checking ALL rows

with open(os.getenv("CSV_IPINFO_PATH"), mode='r', newline='') as file:
    reader = csv.reader(file)
    next(reader, None)
    for row in reader:
        try:
            ip_db.append((int(row[0]), int(row[1]), str(row[13])))
        except (ValueError, IndexError):
            continue

print(json.dumps({"status": "ready", "length": len(ip_db)}), flush=True)

# functions callable by nodejs, change to be called by ipToLocation.py later
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


    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True)