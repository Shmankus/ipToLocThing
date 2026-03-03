
import datetime
import sys
import socket
import struct
from flask import json
from scapy.all import get_if_addr, sniff, IP, conf
import csv
import os
import dotenv
dotenv.load_dotenv()
avgTTC = [0,0] # TTC , counter
geo_cache = {} # cache for ip's and their info
my_ip = get_if_addr(conf.iface) # used ip on device

# saves the average time to search for the CSV file
def saveAvgTime(startTime, endTime):
    if avgTTC[1] == 0:
        avgTTC[0] = (endTime - startTime).total_seconds()
        avgTTC[1] = 1
    else:
        avgTTC[0] = ((avgTTC[0] * avgTTC[1]) + (endTime - startTime).total_seconds()) / (avgTTC[1]+1) # avg calculation
        avgTTC[1]+=1

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

# converts the decimal ip to the correct digit format
def ip_to_int(ip):
    try:
        return struct.unpack("!I", socket.inet_aton(ip))[0]
    except Exception:
        return None

# gets the longitude, latitude and average lookup time for nodejs
def get_geolocation_CSV(ip):
    startTime = datetime.datetime.now()
    
    if ip in geo_cache:
        return geo_cache[ip]

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

    return

# helper function that collects the ip from the packet and prints the json for nodejs
def packet_callback(packet):
    if IP in packet:
        if packet[IP].dst not in ['127.0.0.1', my_ip]:
            destination_ip = packet[IP].dst
            location = get_geolocation_CSV(destination_ip)
            print(json.dumps(location))
            sys.stdout.flush()

sniff(prn=packet_callback, store=0, filter="ip")