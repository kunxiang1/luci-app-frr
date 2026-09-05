#!/bin/sh
# self-check for frr-uci-export: stub `uci` with canned data, assert generated frr.conf.
# run:  sh scripts/test-export.sh   (any POSIX sh, incl. git-bash)
set -e
SRC=$(cd "$(dirname "$0")/.." && pwd)/root/usr/sbin/frr-uci-export
chmod +x "$SRC" 2>/dev/null || true
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/state" <<'EOF'
frr.global.enabled=1
frr.global.hostname=TestRtr
frr.global.log_level=informational
frr.bgp.enabled=1
frr.bgp.as=65001
frr.bgp.router_id=10.0.0.1
frr.bgp.keepalive=60
frr.bgp.holdtime=180
frr.bgp.distance_ebgp=20
frr.bgp.distance_ibgp=200
frr.bgp.distance_local=200
frr.bgp.gr=1
frr.bgp.gr_period=120
frr.bgp.maxpath_ebgp=8
frr.bgp.maxpath_ibgp=8
frr.bgp.network4=192.168.10.0/24
frr.bgp.redistribute4=static:10:rmap1 connected
frr.bgp.network6=2001:db8::/64
frr.rip.enabled=1
frr.rip.version=2
frr.rip.distance=120
frr.rip.update_timer=30
frr.rip.timeout_timer=180
frr.rip.flush_timer=120
frr.rip.network=192.168.1.0/24
frr.rip.redistribute=static:2
frr.ospf.enabled=1
frr.ospf.router_id=10.0.0.1
frr.ospf.spf_delay=200
frr.ospf.spf_hold=1000
frr.ospf.spf_max=5000
frr.ospf.distance_intra=110
frr.ospf.distance_inter=110
frr.ospf.distance_external=110
frr.ospf.redistribute=kernel:10
frr.ospf.default_originate=1
frr.ospf.always=1
frr.isis.enabled=1
frr.isis.name=main
frr.isis.net=49.0001.0000.0000.0001.00
frr.isis.is_type=level-1-2
frr.isis.metric_style=wide
frr.eigrp.enabled=1
frr.eigrp.name=1
frr.eigrp.network=10.0.0.0/8
frr.babel.enabled=1
frr.babel.network=eth0
frr.babel.redistribute=ipv4:kernel:10
frr.pim.enabled=1
frr.pim.rp_address=10.0.0.99
frr.ldp.enabled=1
frr.ldp.router_id=10.0.0.1
frr.ldp.transport_address=10.0.0.1
frr.ldp.interfaces=eth0
frr.rw.enabled=1
frr.rw.lines='router nhrp' ' tunnel' '  max-hop-count 3'
frr.sr.enabled=1
frr.sr.mpls_te=1
frr.sr.gb_lower=16000
frr.sr.gb_upper=16999
frr.sr.node_msd=8
frr.sr.ted_import=isis
EOF
cat > "$TMP/sections" <<'EOF'
bgp_neighbor|n1
bgp_aggregate|a1
ospf_area|ar0
ospf_network|nw1
ospf_interface|if1
rip_interface|rif1
isis_interface|iif1
vrrp|vr1
bfd|bd1
raw|rw
sr_prefix|sp1
sr_seglist|sl1
sr_policy|po1
EOF
cat > "$TMP/opts" <<'EOF'
n1.address=10.0.0.2
n1.remote_as=65002
n1.activate=1
n1.route_map_in=rmIn
a1.family=4
a1.prefix=10.0.0.0/8
a1.as_set=1
ar0.area=0
ar0.type=nssa
ar0.no_summary=1
nw1.cidr=10.0.0.0/24
nw1.area=0
if1.ifname=eth1
if1.cost=10
if1.auth=md5
if1.auth_key=secret
if1.passive=0
rif1.ifname=eth2
rif1.passive=1
rif1.auth_mode=text
rif1.auth_key=ripkey
iif1.ifname=eth3
iif1.area_tag=main
iif1.p2p=1
vr1.ifname=eth4
vr1.vrid=10
vr1.priority=120
vr1.addr=10.0.0.250
vr1.version=3
vr1.preempt=1
bd1.peer=10.0.0.5
bd1.multiplier=3
bd1.min_tx=100
bd1.min_rx=100
bd1.enabled=1
rw.enabled=1
rw.lines='router nhrp' ' tunnel' '  max-hop-count 3'
sp1.prefix=10.0.0.1/32
sp1.sid_type=index
sp1.sid_value=100
sp1.algorithm=128
sp1.explicit_null=1
sl1.name=SL1
sl1.entry='index 10 mpls label 16001' 'index 20 nai adjacency 10.1.20.1 10.1.20.2'
po1.color=1
po1.endpoint=192.0.2.1
po1.name=red
po1.binding_sid=4000
po1.candidate='candidate-path preference 100 name CP1 explicit segment-list SL1'
EOF

# uci stub: get frr.X.Y from state, else frr.<sid>.<opt> from opts;
# "show" or "show frr" lists everything; "show frr.sid.opt" greps one key.
cat > "$TMP/uci" <<'EOF'
#!/bin/sh
[ "$1" = -q ] && shift
case "$1" in
get)
	key=${2#frr.}
	v=$(sed -n "s|^frr\.$key=||p" "$FAKE_UCI_STATE" | head -1)
	[ -n "$v" ] && { echo "$v"; exit 0; }
	sid=${key%%.*}; opt=${key#*.}
	sed -n "s|^$sid\.$opt=||p" "$FAKE_UCI_OPTS" | head -1
	;;
show)
	if [ -z "$2" ] || [ "$2" = frr ]; then
		cat "$FAKE_UCI_STATE"
		while IFS='|' read -r t sid; do echo "frr.$sid=$t"; done < "$FAKE_UCI_SECTIONS"
	else
		k=${2#frr.}
		grep "^frr\.$k=" "$FAKE_UCI_STATE" || grep "^$k=" "$FAKE_UCI_OPTS" | sed "s|^|$2=|"
	fi
	;;
*) exit 1 ;;
esac
EOF
chmod +x "$TMP/uci"
# fake daemon binaries so hasbin() passes for every protocol
mkdir -p "$TMP/bin"
for d in bgpd ospfd ospf6d ripd ripngd isisd eigrpd babeld pimd pim6d ldpd vrrpd bfdd pathd; do : > "$TMP/bin/$d"; chmod +x "$TMP/bin/$d"; done
export BINDIR="$TMP/bin"
export FAKE_UCI_STATE="$TMP/state" FAKE_UCI_SECTIONS="$TMP/sections" FAKE_UCI_OPTS="$TMP/opts"
export PATH="$TMP:$PATH"

out=$("$SRC" --stdout)
printf '%s\n' "$out"

fail=0
chk() { printf '%s\n' "$out" | grep -qF "$1" || { echo "MISSING: $1"; fail=1; }; }
chkabsent() { if printf '%s\n' "$out" | grep -qF "$1"; then echo "SHOULD NOT CONTAIN: $1"; fail=1; fi; }

# BGP
chk "router bgp 65001"
chk " no bgp ebgp-requires-policy"
chk " neighbor 10.0.0.2 timers 60 180"
chk "  neighbor 10.0.0.2 activate"
chk " redistribute static metric 10 route-map rmap1"
chk " aggregate-address 10.0.0.0/8 as-set"
# OSPF
chk "router ospf"
chk " distance ospf intra-area 110 inter-area 110 external 110"
chk " area 0 nssa no-summary"
chk " network 10.0.0.0/24 area 0"
chk " default-information originate always"
chk " ip ospf message-digest-key 1 md5 secret"
# RIP
chk "router rip"
chk " timers basic 30 180 120"
chk " ip rip authentication text-password ripkey"
# ISIS
chk "router isis main"
chk " net 49.0001.0000.0000.0001.00"
chk " is-type level-1-2"
chk " ip router isis main"
chk " isis network point-to-point"
# EIGRP
chk "router eigrp 1"
chk " network 10.0.0.0/8"
# BABEL
chk "router babel"
chk " redistribute ipv4 kernel metric 10"
# PIM
chk "router pim"
chk " rp-address 10.0.0.99"
# LDP
chk "mpls ldp"
chk "  discovery transport-address 10.0.0.1"
# VRRP
chk " vrrp 10 version 3"
chk " vrrp 10 priority 120"
chk " vrrp 10 ip 10.0.0.250"
# BFD
chk "peer 10.0.0.5"
chk " detect multiplier 3"
# RAW
chk "router nhrp"
chk "  max-hop-count 3"
# Segment-Routing (IS-IS part)
chk " segment-routing on"
chk " segment-routing global-block 16000 16999"
chk " segment-routing node-msd 8"
chk " segment-routing prefix 10.0.0.1/32 algorithm 128 index 100 explicit-null"
# Segment-Routing TE (pathd)
chk "segment-routing"
chk " traffic-eng"
chk "  mpls-te on"
chk "  mpls-te import isis"
chk "  segment-list SL1"
chk "   index 10 mpls label 16001"
chk "   index 20 nai adjacency 10.1.20.1 10.1.20.2"
chk "  policy color 1 endpoint 192.0.2.1"
chk "   name red"
chk "   binding-sid 4000"
chk "   candidate-path preference 100 name CP1 explicit segment-list SL1"
# absent (disabled protocols)
chkabsent "router ospf6"
chkabsent "router ripng"
chk "hostname TestRtr"
chk "line vty"

# daemons generation
CONFDIR="$TMP" DAEMONS="$TMP/daemons.out" FFCONF="$TMP/frr.conf.out" sh "$SRC" >/dev/null 2>&1 || true
dout=$(cat "$TMP/daemons.out")
for d in bgpd ospfd ripd isisd eigrpd babeld pimd ldpd vrrpd bfdd; do
	printf '%s\n' "$dout" | grep -q "^$d=yes" || { echo "DAEMONS: $d not yes"; fail=1; }
done
printf '%s\n' "$dout" | grep -q "^ripngd=no" || { echo "DAEMONS: ripngd not no"; fail=1; }

[ "$fail" = 0 ] && echo "== ALL PASSED ==" || { echo "== FAILED =="; exit 1; }
