from scapy.all import get_if_list, conf

# See what Windows actually calls your interfaces
print(get_if_list())
print(conf.iface)