
import sys
import socket
import struct
from flask import json
from scapy.all import get_if_addr, sniff, IP, conf
import csv
import os
import dotenv
dotenv.load_dotenv()

geo_cache = {}
my_ip = get_if_addr(conf.iface)

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

def ip_to_int(ip):
    try:
        return struct.unpack("!I", socket.inet_aton(ip))[0]
    except Exception:
        return None

def get_geolocation_CSV(ip):
    if ip in geo_cache:
        return geo_cache[ip]

    ip_int = ip_to_int(ip)
    if ip_int is None:
        return

    for start, end, lat, lon in ip_db:
        if start <= ip_int <= end:
            location = {"lat": lat, "lon": lon, "ip": ip}
            geo_cache[ip] = location
            return location

    return

def packet_callback(packet):
    if IP in packet:
        if packet[IP].dst not in ['127.0.0.1', my_ip]:
            destination_ip = packet[IP].dst
            location = get_geolocation_CSV(destination_ip)
            print(json.dumps(location))
            sys.stdout.flush()

sniff(prn=packet_callback, store=0, filter="ip")