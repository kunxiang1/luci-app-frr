'use strict';
'require rpc';
'require ui';
'require uci';

// shared helpers for the FRR views (legacy LuCI JS >=21.x).
// rpcd file.exec signature is (command:String, params:Array) — NOT {cmd:[...]}.
// LuCI's require() instantiates the module's return value, so we must yield a
// Class subclass; the real payload is the L.frr side-effect below.
L.frr = {
	// run generator/reloader after uci.commit
	apply: function() {
		return rpc.declare({
			object: 'file', method: 'exec',
			params: ['command', 'params'],
			expect: { '': {} }
		})('/usr/sbin/frr-uci-export', []).then(function(res) {
			if (res && res.code !== 0) {
				var out = ((res.stderr || res.stdout) || '').trim();
				// code 6 = rpcd PERMISSION_DENIED (ACL mismatch), no stderr at all
				throw new Error(_('frr-uci-export failed: %s').format(out || ('no output, rpcd code ' + res.code)));
			}
			return res;
		});
	},

	// vtysh one-liner -> stdout text. BusyBox has no `timeout` applet and vtysh
	// can block on stale sockets, so race against a 6s JS timer.
	vtysh: function(cmd) {
		var p = rpc.declare({
			object: 'file', method: 'exec',
			params: ['command', 'params'],
			expect: { '': {} }
		})('/usr/bin/vtysh', ['-c', cmd]).then(function(res) { return (res && res.stdout) || ''; });
		return Promise.race([p, new Promise(function(r) { window.setTimeout(r.bind(null, ''), 6000); })]);
	},

	// interface list from /sys/class/net (netifd RPC can hang; ls is bulletproof)
	ifaces: function() {
		var p = rpc.declare({
			object: 'file', method: 'exec',
			params: ['command', 'params'],
			expect: { '': {} }
		})('/bin/ls', ['/sys/class/net']).then(function(res) {
			return ((res && res.stdout) || '').split(/\s+/).filter(Boolean);
		});
		return Promise.race([p, new Promise(function(r) { window.setTimeout(r.bind(null, []), 6000); })]);
	},

	// one-shot status snapshot via frr-status (hard per-cmd timeout server-side,
	// so a hung vtysh can never wedge the single-threaded rpcd).
	// resolves to {ifaces:[], version:'', daemons:[], route4:'', route6:''}
	status: function() {
		var p = rpc.declare({
			object: 'file', method: 'exec',
			params: ['command', 'params'],
			expect: { '': {} }
		})('/usr/sbin/frr-status', []).then(function(res) {
			var txt = (res && res.stdout) || '';
			var sec = {};
			var cur = '_';
			txt.split(/\r?\n/).forEach(function(line) {
				var m = line.match(/^===([A-Z0-9]+)===$/);
				if (m) { cur = m[1].toLowerCase(); sec[cur] = ''; return; }
				sec[cur] = (sec[cur] || '') + line + '\n';
			});
			return {
				ifaces: (sec.ifaces || '').split(/\s+/).filter(Boolean),
				version: (sec.version || '').trim(),
				daemons: (sec.daemons || '').trim(),
				pids: (sec.pids || '').split(/\s+/).filter(Boolean),
				route4: sec.route4 || '',
				route6: sec.route6 || ''
			};
		});
		return Promise.race([p, new Promise(function(r) {
			window.setTimeout(r.bind(null, { ifaces: [], version: '', daemons: '', pids: [], route4: '', route6: '' }), 12000);
		})]);
	},

	// attach to a Map: after any save (plain or &-apply), regenerate frr.conf.
	// This LuCI build has no onaftersave hook; every save path funnels through
	// map.save(), so wrapping it is the single reliable interception point.
	// IMPORTANT: uci.save() only STAGES changes into rpcd's session delta; they
	// reach /etc/config only at uci.apply(). frr-uci-export runs as a separate
	// process reading disk, so it must run AFTER the apply, not right after
	// save (that race is why toggling OSPF left daemons ospfd=no).
	// rollback=false: plain commit, no 3s auto-revert timer to confirm against.
	callApply: rpc.declare({
		object: 'uci', method: 'apply',
		params: ['timeout', 'rollback'], reject: true
	}),
	bindApply: function(m) {
		var origSave = m.save.bind(m);
		m.save = function(cb, silent) {
			return origSave(cb, silent).then(function() {
				return L.frr.callApply(0, false);
			}).then(function() {
				return L.frr.apply().then(function() {
					ui.addNotification(null, E('p', _('Configuration written to FRR and reloaded.')), 'info');
				});
			}).catch(function(e) {
				ui.addNotification(null, E('p', e.message), 'error');
			});
		};
	}
};

return L.Class.extend({});
