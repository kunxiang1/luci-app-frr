'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require ui';
'require view/frr/api';

var RE4 = /^(\d{1,3}\.){3}\d{1,3}$/;
var RE4C = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
var RE6C = /^[0-9a-fA-F:]+\/\d{1,3}$/;

function intRange(min, max) {
	return function(sid, val) {
		if (val === '') return true;
		if (!/^\d+$/.test(val) || Number(val) < min || Number(val) > max)
			return _('取值范围：%d-%d').format(min, max);
		return true;
	};
}
function v4(v) { return RE4.test(v); }
function v4c(v) { return RE4C.test(v); }
function v6c(v) { return RE6C.test(v); }
function v46(v) { return v4(v) || /^[0-9a-fA-F:]+(\/\d{1,3})?$/.test(v); }
function area(v) { return /^\d+$/.test(v) || v4(v); }
function redir(v) { return /^(kernel|connected|static|bgp|ospf|ospf6|rip|ripng|babel|eigrp|isis)(:\d{1,10}(:[A-Za-z0-9_-]+)?)?$/.test(v); }

/* protocol enable/run matrix */
var PROTOS = [
	['bgp', 'bgpd', 'BGP'], ['ospf', 'ospfd', 'OSPFv2'], ['ospf6', 'ospf6d', 'OSPFv3'],
	['rip', 'ripd', 'RIP'], ['ripng', 'ripngd', 'RIPng'],
	['isis', 'isisd', 'IS-IS'], ['eigrp', 'eigrpd', 'EIGRP'], ['babel', 'babeld', 'Babel'],
	['pim', 'pimd', 'PIM (IPv4)'], ['pim6', 'pim6d', 'PIM (IPv6)'],
	['ldp', 'ldpd', 'LDP'], ['vrrp', 'vrrpd', 'VRRP'], ['bfd', 'bfdd', 'BFD']
];
var CODEMAP = { K:'kernel', C:'直连', L:'本机', S:'静态', R:'RIP', O:'OSPF', OIA:'OSPF 区域间',
	OE1:'OSPF 外部 1', OE2:'OSPF 外部 2', B:'BGP', A:'Babel', E:'EIGRP',
	I:'IS-IS', N:'NHRP', T:'Table', v:'VNC', F:'PBR' };

function renderRoutes(txt, title) {
	var rows = [];
	(txt || '').split(/\r?\n/).forEach(function(line) {
		var m = line.match(/^([A-Z][A-Z0-9]{0,3})\s*([>*=qribto ]{0,3})\s+(\S+)\s+\[(\d+)\/([\d.]+)\]\s*(.*)$/);
		if (m) {
			var rest = m[6].replace(/, weight \d+/, '').replace(/, \d\d:\d\d:\d\d.*$/, '').trim();
			var im = rest.match(/^via (\S+?)(?:,\s*(\S+))?$/);
			rows.push(E('tr', {}, [
				E('td', CODEMAP[m[1]] || m[1]),
				E('td', m[3]),
				E('td', m[4]),
				E('td', m[5]),
				E('td', im ? im[1] : rest),
				E('td', im && im[2] ? im[2] : '-')
			]));
			return;
		}
		m = line.match(/^([A-Z])\s*([>*= ]{0,3})\s+(\S+)\s+is directly connected,\s*(.*)$/);
		if (m) {
			rows.push(E('tr', {}, [
				E('td', CODEMAP[m[1]] || m[1]), E('td', m[3]),
				E('td', '-'), E('td', '-'), E('td', '-'), E('td', m[4])
			]));
		}
	});
	if (!rows.length)
		return E('div', {}, [E('h5', title), E('pre', txt || _('（无路由）'))]);
	return E('div', {}, [E('h5', title), E('table', { 'class': 'table cbi-section-table' }, [
		E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th' }, _('协议')),
			E('th', { 'class': 'th' }, _('目的网段')),
			E('th', { 'class': 'th' }, _('距离')),
			E('th', { 'class': 'th' }, _('度量')),
			E('th', { 'class': 'th' }, _('下一跳')),
			E('th', { 'class': 'th' }, _('出接口'))
		])
	].concat(rows))]);
}

function fillStatus(root) {
	if (!document.querySelector('link[data-frrcss]')) {
		var link = E('link', { rel: 'stylesheet', 'data-frrcss': '1',
			href: '/luci-static/resources/frr.css?_=' + Date.now() });
		document.head.appendChild(link);
	}
	L.frr.status().then(function(st) {
		var running = !!st.version || st.pids.length > 0;
		var box = root.querySelector('#frr-status-box');
		if (box) {
			box.innerHTML = '';
			box.appendChild(E('em', { 'class': running ? 'status-ok' : 'status-off' },
				running ? _('运行中') : _('未运行')));
			box.appendChild(E('pre', { 'style': 'margin-top:.5em' },
				st.version ? st.version.split('\n')[0] : _('无法连接 vtysh——FRR 是否已安装并运行？')));
		}
		var dset = {};
		(st.daemons || '').split(/\s+/).forEach(function(d) { dset[d] = true; });
		st.pids.forEach(function(d) { dset[d] = true; });
		var mbox = root.querySelector('#frr-matrix-box');
		if (mbox) {
			var rows = PROTOS.map(function(p) {
				var en = (p[0] === 'vrrp' || p[0] === 'bfd')
					? uci.sections('frr', p[0]).length > 0
					: uci.get('frr', p[0], 'enabled') === '1';
				var run = !!dset[p[1]];
				return E('tr', {}, [
					E('td', p[2]),
					E('td', {}, en ? _('已启用') : _('未启用')),
					E('td', {}, E('em', { 'class': run ? 'status-ok' : 'status-off' },
						run ? _('运行中') : _('未运行')))
				]);
			});
			mbox.innerHTML = '';
			mbox.appendChild(E('table', { 'class': 'table cbi-section-table' }, [
				E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th' }, _('协议')),
					E('th', { 'class': 'th' }, _('界面配置')),
					E('th', { 'class': 'th' }, _('守护进程'))
				])
			].concat(rows)));
		}
		var rbox = root.querySelector('#frr-routes-box');
		if (rbox) {
			rbox.innerHTML = '';
			rbox.appendChild(renderRoutes(st.route4, 'IPv4'));
			rbox.appendChild(renderRoutes(st.route6, 'IPv6'));
		}
	});
}

return view.extend({
	load: function() {
		// uci + `ls` only — both are fast and can never wedge rpcd.
		// vtysh-backed status is fetched asynchronously AFTER render.
		return Promise.all([
			uci.load('frr'),
			L.frr.ifaces()
		]);
	},

	render: function(res) {
		var devnames = (res[1] || []).slice().sort();
		function ifaceValue(section, title) {
			var ov = section.option(form.ListValue, 'ifname', title || _('接口'));
			ov.optional = true;   // allow legacy hand-typed names not in current device list
			devnames.forEach(function(n) { ov.value(n, n); });
			return ov;
		}
		function ifaceMulti(section, option, title, desc) {
			var ov = section.option(form.MultiValue, option, title, desc);
			ov.optional = true;
			devnames.forEach(function(n) { ov.value(n, n); });
			return ov;
		}
		var m, s, o, sub;

		m = new form.Map('frr', _('FRR 动态路由套件'),
			[ _('FRR（FRRouting）是一套开源动态路由套件，包含 BGP、OSPF、RIP、IS-IS、EIGRP、Babel、PIM、LDP、VRRP、BFD 等主流路由协议的完整实现，兼容 Quagga 并遵循 IETF 标准。本界面将配置统一写入 UCI，保存后自动生成 /etc/frr 配置并重载守护进程。详见 '),
			  E('a', { href: 'https://frrouting.org/', target: '_blank', rel: 'noopener' }, 'frrouting.org'),
			  _('。') ]);
		m.tabbed = true;

		/* ================= 全局 ================= */
		s = m.section(form.NamedSection, 'global', 'frr', _('全局'));
		o = s.option(form.Flag, 'enabled', _('启用 FRR'), _('禁用后将停止所有路由守护进程。'));
		o = s.option(form.Value, 'hostname', _('主机名'));
		o.validate = function(sid, val) {
			if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(val)) return true;
			return _('无效主机名');
		};
		o = s.option(form.ListValue, 'log_level', _('日志级别'));
		['errors', 'warnings', 'informational', 'debugging'].forEach(function(v) { o.value(v, v); });
		o = s.option(form.DummyValue, '_status', _('服务状态'));
		o.cfgvalue = function() {
			return E('div', { 'id': 'frr-status-box' }, E('em', _('加载中…')));
		};

		o = s.option(form.DummyValue, '_protocols', _('协议状态'));
		o.cfgvalue = function() {
			return E('div', { 'id': 'frr-matrix-box' }, E('em', _('加载中…')));
		};

		o = s.option(form.DummyValue, '_routes', _('路由表'));
		o.cfgvalue = function() {
			return E('div', { 'id': 'frr-routes-box' }, E('em', _('加载中…')));
		};

		/* ================= BGP ================= */
		s = m.section(form.NamedSection, 'bgp', 'bgp', _('BGP'));
		s.tab('general', _('基本配置'));
		s.tab('priority', _('路由优先级'));
		s.tab('networks4', _('IPv4 单播'));
		s.tab('networks6', _('IPv6 单播'));
		s.tab('neighbors', _('邻居配置'));
		s.tab('aggregates', _('聚合地址'));

		o = s.taboption('general', form.Flag, 'enabled', _('启用 BGP'));
		o = s.taboption('general', form.Value, 'as', _('本机 AS 号'));
		o.validate = intRange(1, 4294967295);
		o = s.taboption('general', form.Value, 'router_id', _('路由器 ID'));
		o.validate = function(sid, val) { return v4(val) || _('无效 IPv4 地址'); };
		o = s.taboption('general', form.Value, 'keepalive', _('心跳包间隔（秒）'));
		o.default = '60'; o.validate = intRange(0, 65535);
		o = s.taboption('general', form.Value, 'holdtime', _('保持时间（秒）'), _('0 表示关闭保持计时器；心跳时间应小于保持时间的 1/3。'));
		o.default = '180'; o.validate = intRange(0, 65535);
		o = s.taboption('general', form.Flag, 'gr', _('平滑重启'));
		o = s.taboption('general', form.Value, 'gr_period', _('平滑重启周期（秒）'));
		o.depends('gr', '1'); o.default = '120'; o.validate = intRange(1, 3600);

		o = s.taboption('priority', form.Value, 'distance_ebgp', _('EBGP 路由管理距离'));
		o.default = '20'; o.validate = intRange(1, 255);
		o = s.taboption('priority', form.Value, 'distance_ibgp', _('IBGP 路由管理距离'));
		o.default = '200'; o.validate = intRange(1, 255);
		o = s.taboption('priority', form.Value, 'distance_local', _('本地路由管理距离'));
		o.default = '200'; o.validate = intRange(1, 255);
		o = s.taboption('priority', form.Value, 'maxpath_ebgp', _('EBGP 最大路径数'));
		o.default = '8'; o.validate = intRange(1, 256);
		o = s.taboption('priority', form.Value, 'maxpath_ibgp', _('IBGP 最大路径数'));
		o.default = '8'; o.validate = intRange(1, 256);

		o = s.taboption('networks4', form.DynamicList, 'network4', _('宣告网段'));
		o.validate = function(sid, val) { if (val === '') return true; return v4c(val) || _('无效 IPv4 网段'); };
		o = s.taboption('networks4', form.DynamicList, 'redistribute4', _('路由重发布'), _('格式：协议[:度量值[:路由映射]]'));
		o.validate = function(sid, val) { if (val === '') return true; return redir(val) || _('格式：协议[:度量值[:路由映射]]'); };
		o = s.taboption('networks6', form.DynamicList, 'network6', _('宣告网段'));
		o.validate = function(sid, val) { if (val === '') return true; return v6c(val) || _('无效 IPv6 网段'); };
		o = s.taboption('networks6', form.DynamicList, 'redistribute6', _('路由重发布'), _('格式：协议[:度量值[:路由映射]]'));
		o.validate = function(sid, val) { if (val === '') return true; return redir(val) || _('格式：协议[:度量值[:路由映射]]'); };

		// neighbors + aggregates nested inside the BGP tab via SectionValue
		o = s.taboption('neighbors', form.SectionValue, '_neighbors', form.TypedSection, 'bgp_neighbor', _('BGP 邻居'));
		sub = o.subsection;
		sub.anonymous = true; sub.addremove = true;
		o = sub.option(form.Value, 'address', _('邻居地址'));
		o.validate = function(sid, val) { return v46(val) || _('无效 IPv4/IPv6 地址'); };
		o = sub.option(form.Value, 'remote_as', _('邻居 AS 号'));
		o.validate = intRange(1, 4294967295);
		o = sub.option(form.Value, 'description', _('描述'));
		o = sub.option(form.Value, 'password', _('密码（MD5）'));
		o.password = true;
		o = sub.option(form.Value, 'update_source', _('更新源'), _('本端 IP 地址或接口名。'));
		o = sub.option(form.Value, 'ebgp_multihop', _('最大跳跃数'));
		o.validate = intRange(1, 255);
		o = sub.option(form.Flag, 'activate', _('激活'));
		o = sub.option(form.Value, 'route_map_in', _('入站路由映射'));
		o = sub.option(form.Value, 'route_map_out', _('出站路由映射'));

		o = s.taboption('aggregates', form.SectionValue, '_aggregates', form.TypedSection, 'bgp_aggregate', _('BGP 聚合地址'));
		sub = o.subsection;
		sub.anonymous = true; sub.addremove = true;
		o = sub.option(form.ListValue, 'family', _('地址族'));
		o.value('4', 'IPv4'); o.value('6', 'IPv6');
		o = sub.option(form.Value, 'prefix', _('聚合网段'));
		o.validate = function(sid, val) {
			var fam = this.formvalue(sid, 'family');
			if (fam === '4' && v4c(val)) return true;
			if (fam === '6' && v6c(val)) return true;
			return _('无效网段');
		};
		o = sub.option(form.Flag, 'as_set', _('AS 路径集合'));
		o = sub.option(form.Flag, 'summary_only', _('仅发布汇总'));

		/* ================= OSPFv2 ================= */
		s = m.section(form.NamedSection, 'ospf', 'ospf', _('OSPFv2'));
		s.tab('general', _('基本配置'));
		s.tab('timers', _('定时器'));
		s.tab('redistribute', _('路由重发布'));
		s.tab('areas', _('区域'));
		s.tab('networks', _('宣告网段'));
		s.tab('interfaces', _('接口'));

		o = s.taboption('general', form.Flag, 'enabled', _('启用 OSPFv2'));
		o = s.taboption('general', form.Value, 'router_id', _('路由器 ID'), _('留空则自动选择。'));
		o.validate = function(sid, val) { return val === '' || v4(val) || _('无效 IPv4 地址'); };
		o = s.taboption('general', form.Value, 'distance_intra', _('域内优先级'));
		o.default = '110'; o.validate = intRange(1, 255);
		o = s.taboption('general', form.Value, 'distance_inter', _('域间优先级'));
		o.default = '110'; o.validate = intRange(1, 255);
		o = s.taboption('general', form.Value, 'distance_external', _('外部优先级'));
		o.default = '110'; o.validate = intRange(1, 255);
		o = s.taboption('general', form.Value, 'maxpath', _('最大等价路由条数'));
		o.validate = intRange(1, 64);
		o = s.taboption('general', form.Flag, 'rfc1583', _('RFC1583 兼容'));

		o = s.taboption('timers', form.Value, 'spf_delay', _('SPF 计算延迟（毫秒）'), _('默认 200。'));
		o.validate = intRange(0, 600000);
		o = s.taboption('timers', form.Value, 'spf_hold', _('SPF 计算间隔（毫秒）'), _('默认 1000。'));
		o.validate = intRange(0, 600000);
		o = s.taboption('timers', form.Value, 'spf_max', _('SPF 最大间隔（毫秒）'), _('默认 5000。'));
		o.validate = intRange(0, 600000);

		o = s.taboption('redistribute', form.DynamicList, 'redistribute', _('路由重发布'), _('格式：协议[:度量值[:路由映射]]'));
		o.validate = function(sid, val) { if (val === '') return true; return redir(val) || _('格式：协议[:度量值[:路由映射]]'); };
		o = s.taboption('redistribute', form.Flag, 'default_originate', _('通告默认路由'));
		o = s.taboption('redistribute', form.Flag, 'always', _('总是'));
		o.depends('default_originate', '1');
		o = s.taboption('redistribute', form.Value, 'default_metric', _('默认路由度量值'));
		o.depends('default_originate', '1');
		o.validate = intRange(0, 16777214);

		o = s.taboption('areas', form.SectionValue, '_areas', form.TypedSection, 'ospf_area', _('OSPF 区域'));
		sub = o.subsection; sub.anonymous = true; sub.addremove = true;
		o = sub.option(form.Value, 'area', _('区域 ID'), _('点分或整数，如 0'));
		o.validate = function(sid, val) { return area(val) || _('无效区域 ID'); };
		o = sub.option(form.ListValue, 'type', _('区域类型'));
		o.value('', _('普通区域')); o.value('stub', _('Stub')); o.value('nssa', _('NSSA'));
		o = sub.option(form.Flag, 'no_summary', _('不发送汇总'));
		o = sub.option(form.Value, 'virtual_link', _('虚连接（过渡区域路由器 ID）'));
		o.validate = function(sid, val) { return val === '' || v4(val) || _('无效 IPv4 地址'); };

		o = s.taboption('networks', form.SectionValue, '_nets', form.TypedSection, 'ospf_network', _('宣告网段'));
		sub = o.subsection; sub.anonymous = true; sub.addremove = true;
		o = sub.option(form.Value, 'cidr', _('宣告网段'), _('如 192.168.1.0/24'));
		o.validate = function(sid, val) { return v4c(val) || _('无效 IPv4 网段'); };
		o = sub.option(form.Value, 'area', _('区域 ID'));
		o.default = '0';
		o.validate = function(sid, val) { return area(val) || _('无效区域 ID'); };

		o = s.taboption('interfaces', form.SectionValue, '_ifaces', form.TypedSection, 'ospf_interface', _('OSPF 接口'));
		sub = o.subsection; sub.anonymous = true; sub.addremove = true;
		ifaceValue(sub);
		o = sub.option(form.Value, 'cost', _('开销'));
		o.validate = intRange(1, 65535);
		o = sub.option(form.ListValue, 'network_type', _('网络类型'));
		o.value('', _('默认'));
		['broadcast', 'point-to-point', 'non-broadcast', 'point-to-multipoint'].forEach(function(v) { o.value(v, v); });
		o = sub.option(form.ListValue, 'auth', _('认证方式'));
		o.value('', _('不认证')); o.value('simple', _('明文')); o.value('md5', _('MD5'));
		o = sub.option(form.Value, 'auth_key', _('认证密码'));
		o.depends('auth', 'simple'); o.depends('auth', 'md5');
		o.password = true;
		o = sub.option(form.Flag, 'passive', _('被动接口'));

		/* ================= OSPFv3 ================= */
		s = m.section(form.NamedSection, 'ospf6', 'ospf6', _('OSPFv3'));
		o = s.option(form.Flag, 'enabled', _('启用 OSPFv3'));
		o = s.option(form.Value, 'router_id', _('路由器 ID'));
		o.validate = function(sid, val) { return val === '' || v4(val) || _('无效 IPv4 地址'); };
		o = s.option(form.DynamicList, 'redistribute', _('路由重发布'), _('格式：协议[:度量值[:路由映射]]'));
		o.validate = function(sid, val) { if (val === '') return true; return redir(val) || _('格式：协议[:度量值[:路由映射]]'); };
		o = s.option(form.Flag, 'always', _('总是通告默认路由'));

		/* ================= RIP ================= */
		s = m.section(form.NamedSection, 'rip', 'rip', _('RIP'));
		s.tab('general', _('基本配置'));
		s.tab('timers', _('定时器'));
		s.tab('networks', _('网络与重发布'));
		s.tab('interfaces', _('接口'));

		o = s.taboption('general', form.Flag, 'enabled', _('启用 RIP'));
		o = s.taboption('general', form.ListValue, 'version', _('版本'));
		o.value('1', 'RIPv1'); o.value('2', 'RIPv2');
		o = s.taboption('general', form.Value, 'distance', _('路由优先级（管理距离）'));
		o.default = '120'; o.validate = intRange(1, 255);
		o = s.taboption('general', form.Value, 'default_metric', _('重发布路由默认度量值'));
		o.validate = intRange(1, 16);
		o = s.taboption('general', form.Value, 'maxpath', _('最大等价路由条数'));
		o.validate = intRange(1, 64);

		o = s.taboption('timers', form.Value, 'update_timer', _('更新间隔（秒）'), _('默认 30。'));
		o.validate = intRange(1, 65535);
		o = s.taboption('timers', form.Value, 'timeout_timer', _('失效时间（秒）'), _('默认 180。'));
		o.validate = intRange(1, 65535);
		o = s.taboption('timers', form.Value, 'flush_timer', _('清除时间（秒）'), _('默认 120。'));
		o.validate = intRange(1, 65535);

		o = s.taboption('networks', form.DynamicList, 'network', _('宣告网段'), _('要宣告的网段，如 192.168.1.0/24'));
		o.validate = function(sid, val) { if (val === '') return true; return v4c(val) || _('无效 IPv4 网段'); };
		o = s.taboption('networks', form.DynamicList, 'neighbor', _('邻居配置'), _('以单播方式向这些地址发送更新。'));
		o.validate = function(sid, val) { if (val === '') return true; return v4(val) || _('无效 IPv4 地址'); };
		o = s.taboption('networks', form.DynamicList, 'redistribute', _('路由重发布'), _('格式：协议[:度量值[:路由映射]]'));
		o.validate = function(sid, val) { if (val === '') return true; return redir(val) || _('格式：协议[:度量值[:路由映射]]'); };
		o = s.taboption('networks', form.Flag, 'default_originate', _('通告默认路由'));

		o = s.taboption('interfaces', form.SectionValue, '_ripif', form.TypedSection, 'rip_interface', _('RIP 接口'));
		sub = o.subsection; sub.anonymous = true; sub.addremove = true;
		ifaceValue(sub);
		o = sub.option(form.Flag, 'passive', _('被动接口'));
		o = sub.option(form.ListValue, 'auth_mode', _('认证方式'));
		o.value('', _('不认证')); o.value('text', _('明文')); o.value('md5', _('MD5'));
		o = sub.option(form.Value, 'auth_key', _('认证密码'));
		o.depends('auth_mode', 'text');
		o.password = true;

		/* ================= RIPng ================= */
		s = m.section(form.NamedSection, 'ripng', 'ripng', _('RIPng（IPv6）'));
		o = s.option(form.Flag, 'enabled', _('启用 RIPng'));
		o = s.option(form.Value, 'distance', _('路由优先级'));
		o.validate = intRange(1, 255);
		o = s.option(form.Value, 'update_timer', _('更新间隔（秒）'));
		o.validate = intRange(1, 65535);
		o = s.option(form.Value, 'timeout_timer', _('失效时间（秒）'));
		o.validate = intRange(1, 65535);
		o = s.option(form.Value, 'flush_timer', _('清除时间（秒）'));
		o.validate = intRange(1, 65535);
		o = s.option(form.DynamicList, 'network', _('宣告网段（IPv6）'));
		o.validate = function(sid, val) { if (val === '') return true; return v6c(val) || _('无效网段'); };
		o = s.option(form.DynamicList, 'redistribute', _('路由重发布'), _('格式：协议[:度量值[:路由映射]]'));
		o.validate = function(sid, val) { if (val === '') return true; return redir(val) || _('格式：协议[:度量值[:路由映射]]'); };
		o = s.option(form.Flag, 'default_originate', _('通告默认路由'));

		/* ================= ISIS ================= */
		s = m.section(form.NamedSection, 'isis', 'isis', _('ISIS'));
		s.tab('general', _('基本配置'));
		s.tab('redistribute', _('路由重发布'));
		s.tab('interfaces', _('接口'));

		o = s.taboption('general', form.Flag, 'enabled', _('启用 ISIS'));
		o = s.taboption('general', form.Value, 'name', _('进程标签'), _('router isis 后的名称。'));
		o = s.taboption('general', form.DynamicList, 'net', _('NET 地址'), _('网络实体标题，如 49.0001.0000.0000.0001.00'));
		o = s.taboption('general', form.ListValue, 'is_type', _('设备类型'));
		o.value('level-1', 'Level-1'); o.value('level-2', 'Level-2'); o.value('level-1-2', 'Level-1-2');
		o = s.taboption('general', form.ListValue, 'metric_style', _('度量风格'));
		o.value('', _('默认')); o.value('narrow', 'Narrow'); o.value('wide', 'Wide'); o.value('both', 'Both');

		o = s.taboption('redistribute', form.DynamicList, 'redistribute', _('路由重发布'), _('格式：协议[:度量值[:路由映射]]'));
		o.validate = function(sid, val) { if (val === '') return true; return redir(val) || _('格式：协议[:度量值[:路由映射]]'); };

		o = s.taboption('interfaces', form.SectionValue, '_isisif', form.TypedSection, 'isis_interface', _('ISIS 接口'));
		sub = o.subsection; sub.anonymous = true; sub.addremove = true;
		ifaceValue(sub);
		o = sub.option(form.Value, 'area_tag', _('进程标签'), _('在此接口启用 ISIS（ip router isis）。'));
		o = sub.option(form.Flag, 'p2p', _('点到点网络'));
		o = sub.option(form.ListValue, 'circuit_type', _('链路类型'));
		o.value('', _('默认')); o.value('level-1', 'Level-1'); o.value('level-2', 'Level-2'); o.value('level-1-2', 'Level-1-2');

		/* ================= EIGRP ================= */
		s = m.section(form.NamedSection, 'eigrp', 'eigrp', _('EIGRP'));
		o = s.option(form.Flag, 'enabled', _('启用 EIGRP'));
		o = s.option(form.Value, 'name', _('AS 号 / 命名'), _('router eigrp 后的名称或 AS 号。'));
		o = s.option(form.DynamicList, 'network', _('宣告网段'));
		o.validate = function(sid, val) { if (val === '') return true; return v4c(val) || _('无效 IPv4 网段'); };
		o = ifaceMulti(s, 'passive_interface', _('被动接口'), _('只收不发，选择接口或 default（所有接口默认被动）。'));
		o.value('default', _('default（全部接口）'));
		o = s.option(form.Value, 'distance', _('路由优先级'));
		o.validate = intRange(1, 255);
		o = s.option(form.Value, 'variance', _('非等价负载均衡倍数'));
		o.validate = intRange(1, 128);

		/* ================= BABEL ================= */
		s = m.section(form.NamedSection, 'babel', 'babel', _('Babel'));
		o = s.option(form.Flag, 'enabled', _('启用 Babel'));
		o = ifaceMulti(s, 'network', _('接口'), _('在指定接口启用 Babel。'));
		o = s.option(form.DynamicList, 'redistribute', _('路由重发布'), _('格式：地址族:协议[:度量值]，如 ipv4:kernel'));
		o.validate = function(sid, val) {
			if (val === '' || /^(ipv4|ipv6):(kernel|static|connected|ripl|bgp|ospf)(:\d+)?$/.test(val)) return true;
			return _('格式：地址族:协议[:度量值]');
		};

		/* ================= PIM (v4+v6 one tab) ================= */
		s = m.section(form.NamedSection, 'pim', 'pim', _('PIM'));
		s.tab('general', _('基本配置'));
		s.tab('interfaces', _('接口'));
		o = s.taboption('general', form.Flag, 'enabled', _('启用 PIM (IPv4)'));
		o = s.taboption('general', form.DynamicList, 'rp_address', _('RP 地址 (IPv4)'));
		o.validate = function(sid, val) { if (val === '') return true; return v4(val) || _('无效 IPv4 地址'); };
		o = s.taboption('interfaces', form.SectionValue, '_pimif', form.TypedSection, 'pim_interface', _('PIM 接口'));
		sub = o.subsection; sub.anonymous = true; sub.addremove = true;
		ifaceValue(sub);
		o = sub.option(form.Flag, 'pim', _('启用 PIM'));
		o = sub.option(form.Flag, 'igmp', _('启用 IGMP'));

		// IPv6 half nested in the same tab (own uci section 'pim6' -> router pim6)
		o = s.taboption('general', form.SectionValue, '_pim6', form.NamedSection, 'pim6', 'pim6', _('IPv6'));
		sub = o.subsection;
		o = sub.option(form.Flag, 'enabled', _('启用 PIM (IPv6)'));
		o = sub.option(form.DynamicList, 'rp_address', _('RP 地址 (IPv6)'));
		o.validate = function(sid, val) { if (val === '') return true; return /^[0-9a-fA-F:]+$/.test(val) || _('无效 IPv6 地址'); };

		/* ================= LDP ================= */
		s = m.section(form.NamedSection, 'ldp', 'ldp', _('LDP'));
		o = s.option(form.Flag, 'enabled', _('启用 LDP'));
		o = s.option(form.Value, 'router_id', _('路由器 ID'));
		o.validate = function(sid, val) { return val === '' || v4(val) || _('无效 IPv4 地址'); };
		o = s.option(form.Value, 'transport_address', _('发现传输地址'));
		o.validate = function(sid, val) { return val === '' || v4(val) || _('无效 IPv4 地址'); };
		o = ifaceMulti(s, 'interfaces', _('接口'), _('在该接口启用 LDP 发现。'));

		/* ================= Segment-Routing ================= */
		s = m.section(form.NamedSection, 'sr', 'sr', _('Segment-Routing'));
		s.tab('general', _('基本配置'));
		s.tab('prefix', _('Prefix/Node Segment'));
		s.tab('te', _('SR-TE 策略'));
		s.tab('seglist', _('Segment-List'));

		o = s.taboption('general', form.Flag, 'enabled', _('启用 Segment-Routing'),
			_('SRGB 与 Prefix SID 随 IS-IS 进程下发；SR-TE 策略由 pathd 守护进程承载。'));
		o = s.taboption('general', form.Value, 'gb_lower', _('SRGB 起始标签'), _('global-block lower bound，16-1048575。'));
		o.default = '16000'; o.validate = intRange(16, 1048575);
		o = s.taboption('general', form.Value, 'gb_upper', _('SRGB 结束标签'), _('global-block upper bound。'));
		o.default = '16999'; o.validate = intRange(16, 1048575);
		o = s.taboption('general', form.Value, 'lb_lower', _('本地块起始标签'), _('local-block，可选。'));
		o.validate = intRange(16, 1048575);
		o = s.taboption('general', form.Value, 'lb_upper', _('本地块结束标签'));
		o.validate = intRange(16, 1048575);
		o = s.taboption('general', form.Value, 'node_msd', _('节点最大标签栈深度 (MSD)'), _('1-16，可选。'));
		o.validate = intRange(1, 16);
		o = s.taboption('general', form.Flag, 'mpls_te', _('启用 SR-TE (pathd)'), _('需要安装 frr-pathd 软件包。'));
		o = s.taboption('general', form.ListValue, 'ted_import', _('TED 导入来源'), _('mpls-te import，可选。'));
		o.value('', _('不导入')); o.value('ospfv2', 'OSPFv2'); o.value('isis', 'IS-IS');

		o = s.taboption('prefix', form.SectionValue, '_srprefix', form.TypedSection, 'sr_prefix', _('Prefix/Node SID'));
		sub = o.subsection; sub.anonymous = true; sub.addremove = true;
		o = sub.option(form.Value, 'prefix', _('前缀'), _('如 10.0.0.1/32'));
		o.validate = function(sid, val) { return v4c(val) || v6c(val) || _('无效前缀'); };
		o = sub.option(form.ListValue, 'sid_type', _('SID 类型'));
		o.value('absolute', _('绝对标签')); o.value('index', _('索引'));
		o = sub.option(form.Value, 'sid_value', _('SID 值'), _('absolute：16-1048575；index：0-65535。'));
		o.validate = intRange(0, 1048575);
		o = sub.option(form.Value, 'algorithm', _('算法'), _('128-255，可选。'));
		o.validate = intRange(128, 255);
		o = sub.option(form.Flag, 'explicit_null', _('显式空标签'), _('上游节点以 explicit-null 替代 PHP。'));
		o = sub.option(form.Flag, 'no_php_flag', _('禁止次末跳弹出 (no-php-flag)'));
		o = sub.option(form.Flag, 'n_flag_clear', _('清除 N 标志'), _('仅 index 型 SID 有效。'));

		o = s.taboption('te', form.SectionValue, '_srpolicy', form.TypedSection, 'sr_policy', _('SR-TE Policy'));
		sub = o.subsection; sub.anonymous = true; sub.addremove = true;
		o = sub.option(form.Value, 'color', _('Color'), _('policy color，0-4294967295。'));
		o.validate = intRange(0, 4294967295);
		o = sub.option(form.Value, 'endpoint', _('Endpoint'));
		o.validate = function(sid, val) { return v4(val) || /^[0-9a-fA-F:]+$/.test(val) || _('无效地址'); };
		o = sub.option(form.Value, 'name', _('名称'), _('policy name，可选。'));
		o = sub.option(form.Value, 'binding_sid', _('Binding SID 标签'), _('可选。'));
		o.validate = intRange(16, 1048575);
		o = sub.option(form.DynamicList, 'candidate', _('候选路径'),
			_('每行一条，如 "candidate-path preference 100 name CP1 explicit segment-list SL1" 或 "... dynamic"。'));

		o = s.taboption('seglist', form.SectionValue, '_srseglist', form.TypedSection, 'sr_seglist', _('Segment-List'));
		sub = o.subsection; sub.anonymous = true; sub.addremove = true;
		o = sub.option(form.Value, 'name', _('名称'), _('segment-list 名称。'));
		o = sub.option(form.DynamicList, 'entry', _('段条目'),
			_('每行一条，如 "index 10 mpls label 16001"、"index 20 nai prefix 10.1.2.1/32 iface 1"、"index 30 nai adjacency 10.1.20.1 10.1.20.2"。邻接 SID 通过 nai adjacency 引用（FRR 不支持手工指派邻接 SID）。'));

		/* ================= VRRP ================= */
		s = m.section(form.TypedSection, 'vrrp', _('VRRP'));
		s.anonymous = true; s.addremove = true;
		ifaceValue(s);
		o = s.option(form.Value, 'vrid', _('VRID'), _('虚拟路由器 ID，1-255。'));
		o.validate = intRange(1, 255);
		o = s.option(form.Value, 'priority', _('优先级'), _('1-254，默认 100。'));
		o.default = '100'; o.validate = intRange(1, 254);
		o = s.option(form.Value, 'addr', _('虚拟 IP 地址'));
		o.validate = function(sid, val) { return val === '' || v4(val) || _('无效 IPv4 地址'); };
		o = s.option(form.Value, 'advertise_interval', _('通告间隔（厘秒）'));
		o.validate = intRange(10, 40950);
		o = s.option(form.ListValue, 'version', _('版本'));
		o.value('2', 'VRRPv2'); o.value('3', 'VRRPv3');
		o = s.option(form.Flag, 'preempt', _('抢占'));
		o = s.option(form.Flag, 'shutdown', _('关闭'));

		/* ================= BFD ================= */
		s = m.section(form.TypedSection, 'bfd', _('BFD'));
		s.anonymous = true; s.addremove = true;
		o = s.option(form.Value, 'peer', _('对端地址'));
		o.validate = function(sid, val) { return v46(val) || _('无效 IPv4/IPv6 地址'); };
		o = s.option(form.Value, 'localaddr', _('本端地址'));
		o.validate = function(sid, val) { return val === '' || v46(val) || _('无效地址'); };
		o = s.option(form.Value, 'interface', _('接口'));
		o = s.option(form.Value, 'multiplier', _('检测倍数'));
		o.validate = intRange(1, 255);
		o = s.option(form.Value, 'min_tx', _('最小发送间隔（毫秒）'));
		o.validate = intRange(10, 60000);
		o = s.option(form.Value, 'min_rx', _('最小接收间隔（毫秒）'));
		o.validate = intRange(10, 60000);
		o = s.option(form.Flag, 'enabled', _('启用'), _('取消勾选则 shutdown。'));
		o.default = '1';

		/* ================= 其他（NHRP/Segment-Routing/PBR/FabricD 等） ================= */
		s = m.section(form.TypedSection, 'raw', _('其他协议（原始配置）'));
		s.anonymous = true; s.addremove = true;
		o = s.option(form.Flag, 'enabled', _('启用'));
		o = s.option(form.DynamicList, 'lines', _('vtysh 配置行'), _('每行一条命令，缩进用空格表示。用于 NHRP、Segment-Routing、PBR、FabricD 等未单独建模的协议。'));

		L.frr.bindApply(m);
		return m.render().then(function(node) {
			fillStatus(node);
			return node;
		});
	}
});
