# luci-app-frr 软件设计稿（v2 / 2026-09-05，已交付）

> 本文件是项目的"地图"。改任何功能前先读这里；设计变了先改这里，再改代码。
> 调研原始材料在 `research/`（openwrt/packages frr 打包源码、FRR 官方文档 HTML、
> 深信服 AF 参考页截图与前端 JS、CDP 端到端验证脚本）。
> v1→v2 的变化：范围从 3 协议扩到全部 15 标签；5 个视图文件合并为单页 main.js；
> 独立 status.js 并入 main.js 状态区；新增 frr-status 包装脚本；reload 改为 restart；
> po/ 先删后加——中文为源语言（msgid=中文），po/zh_Hans 恒等映射 + po/templates/*.pot
> 官方扫描器生成，供他人改翻译。

---

## 1. 目标与范围

为 OpenWrt 的 FRR（openwrt/packages `net/frr`，实测 10.4.1 / 打包 10.6.1）做一个 LuCI 管理界面，
布局参考深信服 AF 8.0.107 的 OSPF / RIP / BGP 三页（截图 `research/screenshots/`），
但采用"一个软件一个整体"的单页标签式布局（用户明确要求，仿官方 luci admin/network/dhcp 观感）。

**做**：全局 + BGP + OSPFv2 + OSPFv3 + RIP + RIPng + IS-IS + EIGRP + Babel + PIM(v4/v6) +
LDP + Segment-Routing(SRGB/Prefix-SID/SR-TE) + VRRP + BFD + 原始配置兜底，共 15 标签；
运行状态矩阵 + IPv4/IPv6 路由表格式化展示。
**不做**（YAGNI，需要时按协议补 section）：route-map / prefix-list / access-list 图形编辑
（走"原始配置"标签逐行输入）、多 VRF、策略路由。

## 2. 调研结论（仍有效，编码前查阅）

### 2.1 FRR 配置模型（docs.frrouting.org + research/frr-doc-*.html）

- 全部协议配置集中在一个 vtysh 风格文件 `/etc/frr/frr.conf`；`/etc/frr/daemons` 只控制
  哪些守护进程启动（`bgpd=yes`）+ 启动参数 `-A 127.0.0.1`（v6 族用 `::1`）。
- zebra、staticd、mgmtd 恒启动；协议守护进程按 enabled 与"二进制是否安装"双重门控。
- 语法映射表（生成器输出，权威以 `research/frr-doc-*.html` 为准）：

| 界面概念                  | FRR 命令                                                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RIP 版本/定时器/距离      | `router rip` → `version 2` / `timers basic U T F` / `distance N`                                                                                                 |
| RIP 宣告/邻居/被动        | `network A/M` / `neighbor A` / `passive-interface IF`（属 router 节点，非 interface 块）                                                                         |
| RIP 接口认证              | `interface X` → `ip rip authentication mode <text\|md5>` + `text-password WORD`                                                                                  |
| OSPF 距离/SPF/区域        | `distance ospf <intra-area\|inter-area\|external>` / `timers throttle spf D H X` / `area ID <stub\|nssa> [no-summary]`                                           |
| OSPF 宣告/虚链路          | `network A/M area X` / `area ID virtual-link RID`                                                                                                                |
| OSPF 接口                 | `interface X` → `ip ospf cost/network/authentication/message-digest-key`                                                                                         |
| BGP 全局                  | `router bgp ASN` → `bgp router-id` / `distance bgp E I L` / `maximum-paths N` + `ibgp N` / `graceful-restart [period P]`                                         |
| BGP 邻居                  | `neighbor A remote-as N` / `description` / `password` / `update-source` / `ebgp-multihop` / `timers K H`                                                         |
| BGP 宣告/聚合             | `address-family ipv4/ipv6 unicast` → `network` / `aggregate-address P [as-set] [summary-only]` / `neighbor A activate` / `redistribute`                          |
| IS-IS                     | `router isis TAG` → `net` / `is-type` / `metric-style`；接口 `ip router isis TAG`                                                                                |
| EIGRP                     | `router eigrp NAME` → `network` / `passive-interface (IF\|default)` / `distance` / `variance`（**无接口级命令**）                                                |
| Babel                     | `router babel` → `network IF` / `redistribute AF KIND [metric N]`；接口 `babel <wired\|wireless>`                                                                |
| PIM                       | `router pim` → `rp-address`；接口 `ip pim` / `ip igmp`                                                                                                           |
| LDP                       | `mpls ldp` → `router-id` / `address-family ipv4` → `discovery transport-address` + `interface IF`                                                                |
| Segment-Routing(IS-IS 内) | `segment-routing on` / `global-block L U [local-block]` / `node-msd N` / `prefix P [algorithm A] <absolute\|index> V [explicit-null\|no-php-flag\|n-flag-clear]` |
| SR-TE(pathd)              | 顶层 `segment-routing` → `traffic-eng` → `mpls-te on [import]` / `segment-list` / `policy color C endpoint E` → `binding-sid` / `candidate-path`                 |
| VRRP                      | `interface X` → `vrrp ID [version 3] priority N` / `ip A` / `advertisement-interval` / `preempt` / `shutdown`                                                    |
| BFD                       | `peer A` → `local-address` / `interface` / `detect multiplier` / `desired min tx` / `required min rx` / `shutdown`                                               |

> 邻接 SID：FRR 不支持手工指派，通过 segment-list 的 `nai adjacency <邻接器> <下一跳>` 引用。

### 2.2 OpenWrt 打包集成（research/frr-pkg-*）

- `frr` 包提供 `/etc/init.d/frr`（rc.common，非 procd）、`/usr/sbin/frrcommon.sh`、
  `/etc/frr/{daemons,frr.conf,vtysh.conf}`（conffiles）。
- 启动链：init start → 读 daemons → 起 watchfrr → 逐个 daemon_start → 每个起完 `vtysh -b` 灌 frr.conf。
- 结论：**luci-app 不碰 frr 包的任何文件**，只写生成物 `/etc/frr/{daemons,frr.conf}` 再 `service frr restart`。

### 2.3 参考 UI（深信服 AF，research/refjs/ + api-schemas-summary.txt）

- 三页均为"顶部全局表单 + 组织结构树（网络/接口/邻居/重发布/聚合）"。
- 校验取值范围照抄 AF schema（keepalive [0,65535]、GR period [1,3600]、ECMP [1,8] 等）。
- 术语统一：AF 的"网络"（OSPF）与"宣告网段"（EIGRP）在本界面统一为**宣告网段**（用户指定，行业通用）。

## 3. 架构

**单一事实来源 = UCI**（`/etc/config/frr`）。LuCI 表单 → uci → `frr-uci-export` 生成
`frr.conf`/`daemons` → `service frr restart`。不直接编辑 frr.conf 文本。
代价：CLI 手改的 frr.conf 会被界面保存覆盖（设计如此，README 已注明）。

```
luci-app-frr/
├── Makefile                                   # LUCI_TITLE; DEPENDS:=+frr +frr-zebra +frr-watchfrr +frr-staticd; PKGARCH=all
├── htdocs/luci-static/resources/
│   ├── frr.css                                # 栏位加宽 + 状态/路由表撑满页面 + 列宽分配
│   └── view/frr/
│       ├── api.js                             # L.frr: apply/vtysh/ifaces/status + bindApply(包装 m.save)
│       └── main.js                            # ★单页标签式主界面（15 标签，中文内联）
├── root/
│   ├── etc/config/frr                         # UCI 默认骨架（13 个 NamedSection 预置 + 列表型匿名段）
│   ├── usr/sbin/frr-uci-export                # ★核心生成器（POSIX sh，456 行）
│   ├── usr/sbin/frr-status                    # 一次性状态快照（vtysh 硬超时包装）
│   ├── usr/share/luci/menu.d/luci-app-frr.json   # 网络 → FRR 动态路由（type=view path=frr/main）
│   └── usr/share/rpcd/acl.d/luci-app-frr.json    # uci.frr 读写 + file.exec 白名单
├── po/
│   ├── templates/luci-app-frr.pot         # feeds/luci/build/i18n-scan.pl 生成（新语言起点）
│   └── zh_Hans/luci-app-frr.po            # 中文源语言恒等映射；luci.mk 自动出 luci-i18n-frr-zh-cn 子包
└── scripts/test-export.sh                     # 生成器自检（stub uci，断言输出）
```

### 3.1 frr-uci-export（唯一生成器）

- `g/on/gl/secids/on_any/hasbin` 辅助函数读 UCI；`hasbin` 按 `${BINDIR:-/usr/sbin}/<daemon>`
  是否存在门控——未安装的协议既不写配置块也不置 daemon=yes。
- `gen_daemons()`：zebra/mgmtd/staticd 恒 yes；各协议 `d <proto> <bin>`；vrrpd/bfdd 按
  `on_any` 有无实例；pathd 额外受 `sr.mpls_te` 控制。
- `render()`：固定头（hostname / log syslog / `service integrated-vtysh-config`）→
  按 bgp→ospf→ospf6→rip→ripng→isis→eigrp→babel→pim→pim6→ldp→vrrp→bfd→sr_te→raw→ifaces 顺序 →
  `line vty` 收尾。BGP 固定输出 `no bgp ebgp-requires-policy`（10.x 默认开，静默丢 eBGP 更新）。
- 列表型多行值（raw.lines / sr_seglist.entry / sr_policy.candidate）用
  `uci show | sed -E "s/ ?'([^']*)'/\n\1/g"` 展开，保留行内缩进。
- 模式：无参=写盘+restart；`--stdout`=预览不落盘；`--check`=比对已装文件与将生成内容（exit 1=不一致）。
- **一律 restart 不 reload**：init 的 reload 与 watchfrr 竞争可致守护进程死亡（10.4.1 实测，脚本内 ponytail 注释）。

### 3.2 UCI 数据模型（section ↔ 标签 ↔ 守护进程）

```
config frr 'global'   enabled hostname log_level
config bgp 'bgp'      enabled as router_id keepalive holdtime distance_{ebgp,ibgp,local}
                      maxpath_{ebgp,ibgp} gr gr_period  list network4 network6 redistribute4 redistribute6
  + bgp_neighbor(匿名) address remote_as description password update_source ebgp_multihop activate route_map_{in,out}
  + bgp_aggregate(匿名) prefix as_set summary_only family(4|6)
config ospf 'ospf'    enabled router_id distance_{intra,inter,external} spf_{delay,hold,max}
                      rfc1583 maxpath default_originate always default_metric  list redistribute
  + ospf_area(匿名) area type no_summary virtual_link
  + ospf_network(匿名) cidr area
  + ospf_interface(匿名) ifname cost network_type passive auth auth_key
config ospf6 'ospf6'  enabled router_id always  list redistribute
config rip 'rip'      enabled version distance default_metric {update,timeout,flush}_timer maxpath
                      default_originate  list network neighbor redistribute
config ripng 'ripng'  同 rip 去 v4 专属
  + rip_interface(匿名) ifname passive auth_mode auth_key
config isis 'isis'    enabled name is_type metric_style  list net redistribute
  + isis_interface(匿名) ifname area_tag p2p circuit_type
config eigrp 'eigrp'  enabled name distance variance  list network passive_interface
config babel 'babel'  enabled  list network redistribute
  + babel_interface(匿名) ifname type
config pim 'pim'      enabled  list rp_address      （pim6 同构）
  + pim_interface(匿名) ifname pim igmp
config ldp 'ldp'      enabled router_id transport_address  list interfaces
config sr 'sr'        enabled mpls_te gb_lower gb_upper lb_lower lb_upper node_msd ted_import
  + sr_prefix(匿名)   prefix sid_type sid_value algorithm explicit_null no_php_flag n_flag_clear
  + sr_seglist(匿名)  name  list entry
  + sr_policy(匿名)   color endpoint name binding_sid  list candidate
  + vrrp(匿名,多实例) ifname vrid version priority addr advertise_interval preempt shutdown
  + bfd(匿名,多实例)  peer localaddr interface multiplier min_tx min_rx enabled
  + raw(匿名,多段)    enabled  list lines
```

### 3.3 权限（rpcd ACL）

- `uci.frr` read/write；`ubus rc.status`、`service.list`。
- `file.exec` 白名单（键=**完整命令行**，非匹配前缀）：
  `"/usr/sbin/frr-uci-export --check"`、`"/usr/sbin/frr-status"`、`"/usr/bin/vtysh -c *"`、
  `"/bin/ls /sys/class/net"`（read）；写侧 `"/usr/sbin/frr-uci-export"`。
- vtysh 权限偏大——页面仅 root 可见，接受。

### 3.4 交互约定（沿用用户偏好）

- 底部按钮：取消左、保存在右（LuCI 默认已符合）。
- 单页 `m.tabbed=true`，每协议一个顶层标签；协议内 `s.tab()` 分子标签（BGP 6 子标签等）。
- 文案中文为源语言（msgid），全部走 `_()`；翻译层见 po/（§3.5）。
- 卡片常显，**不用 depends 隐藏字段**（用户明确要求）。
- 接口一律下拉：单值 `form.ListValue`（ifaceValue），多选 `form.MultiValue`（ifaceMulti），
  选项来自 `L.frr.ifaces()`（`/bin/ls /sys/class/net`，非 netifd RPC）。
- 校验中文提示，取值范围照抄 AF schema。

### 3.5 翻译层（OpenWrt 官方规则）

- 所有 UI 字符串走 `_()`，msgid 即中文（源语言）。
- `po/templates/luci-app-frr.pot`：用 `feeds/luci/build/i18n-scan.pl htdocs root` 生成，
  含 menu.d 的 title 与 ACL description。改了界面文案后重新生成并 `msgmerge -U` 同步各语言 po。
- `po/zh_Hans/luci-app-frr.po`：msgstr=msgid 恒等。**po2lmo 会跳过恒等条目**（源码
  `key_id != val_id` 判断），所以 zh-cn.lmo 只含被真正改译的条目；运行时未命中的字符串
  回退显示 msgid（中文），UI 不受影响。这是官方设计，不是打包错误。
- 新语言：复制 .pot 到 `po/<BCP47 tag>/luci-app-frr.po`（目录名是 BCP-47 如 zh_Hans，
  产物后缀是 LuCI 别名如 zh-cn），填 msgstr；luci.mk 按 LUCI_LANG_<tag> 配置自动出
  `luci-i18n-frr-<alias>` 子包（HIDDEN，DEPENDS 主包）。
- 验证链：`msgfmt -c`（语法）→ `po2lmo x.po x.lmo && strings x.lmo`（确认非恒等条目入目录）。

## 4. 状态采集设计（本项目最大的坑，务必先读）

**rpcd 单线程**：一个挂起的 `file.exec` 子进程会堵死所有 RPC（含 uci.load），整页瘫痪。
vtysh 在守护进程 socket 半开时会无限挂起。五层防御：

1. `load()` 只做 `uci.load('frr')` + `L.frr.ifaces()`（`/bin/ls`，两者永不挂）。
2. 状态数据由 `frr-status` 采集：内部对每条 vtysh 用"后台 + 看门狗 `sleep;kill -9`"实现
   3 秒硬超时（BusyBox 无 `timeout` applet）。
3. **看门狗与子命令必须 `</dev/null >/dev/null` 脱钩**——否则孤儿 `sleep` 占住 rpcd 的
   stdout 管道，`file.exec` 等不到 EOF，同样堵死 rpcd（本次真机踩实）；
   **同理 `service frr restart` 也绝不能继承 stdout**：watchfrr 是常驻守护进程，
   继承管道后永不关闭 → rpcd 永久挂起 → LuCI 报 "frr-uci-export failed:"（arm64 实测）。
4. 前端对 status 再套 12 秒 JS `Promise.race` 兜底。
5. vtysh 全挂时按 `/var/run/frr/*.pid`（PIDS 段）判定运行状态，不误报"未运行"。

状态在 `render()` 完成后由 `fillStatus(node)` 异步填充三个占位 div
（`#frr-status-box` / `#frr-matrix-box` / `#frr-routes-box`），失败只影响那一块、不拖垮整页。
CSS 通过 `fillStatus` 里 append `<link data-frrcss>`（带 `?_=时间戳` 破缓存）注入——
本机 LuCI 无 `L.ui.styleSheet`。

## 5. 已知偏差与决策记录

| 概念                                 | FRR 对应               | 决策                                             |
| ------------------------------------ | ---------------------- | ------------------------------------------------ |
| "路由优先级"（OSPF110/RIP120/BGP20） | distance               | 直接映射                                         |
| BGP 定时器                           | 10.x 移到 per-neighbor | 生成器写 `neighbor A timers K H`                 |
| AF 多 OSPF 实例                      | FRR 单进程单实例       | 界面单实例，v2/v3 分标签                         |
| EIGRP 接口配置                       | eigrpd 无接口级命令    | 只做 passive-interface（下拉，含 default）       |
| 邻接 SID 手工指派                    | FRR 不支持             | segment-list 的 nai adjacency 引用               |
| SRGB/Prefix-SID 归属                 | 随 isisd 下发          | 放 IS-IS 的 `segment-routing` 块；SR-TE 归 pathd |
| 路由表格式化                         | vtysh show 文本        | 正则解析成 6 列表格；解析失败退化 `<pre>`        |

## 6. 阶段计划（全部完成）

- [x] **P1 调研**：FRR 文档、openwrt 打包、AF 三页 UI/API（research/）
- [x] **P2 设计稿**：本文件
- [x] **P3 骨架**：Makefile、uci defaults、frr-uci-export（含 test-export.sh 自测）、menu/acl
- [x] **P4 视图**：单页 main.js（15 标签全协议）+ api.js + frr.css；中文内联，删 po/
- [x] **P5 编译验证**：phantun SDK 环境（192.168.234.250）编译 apk，装 133/144，CDP 端到端查菜单/JS/渲染
- [x] **P6 真机联调**：两台组网 BGP/OSPF/RIP 邻居建立 + 路由互学，`vtysh -b` 零错误；
  状态矩阵/路由表/接口下拉/栏位宽度全部实测达标

## 7. 风险与运维

- FRR 10.x mgmtd：daemons 恒 yes，界面不管。
- reload 依赖 frr-pythontools 且与 watchfrr 竞争 → 一律 restart（有秒级中断，路由收敛场景可接受）。
