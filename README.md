# luci-app-frr — OpenWrt FRR 动态路由套件 LuCI 管理界面

为 OpenWrt / ImmortalWrt 上的 [FRRouting](https://frrouting.org/) 提供一站式 Web 管理界面。
单页面标签式布局，覆盖 FRR 全部主流协议，配置以 UCI 为唯一事实来源，保存后自动生成
`/etc/frr/{daemons,frr.conf}` 并重载守护进程。

## 特性

- **一个页面管全部协议**：全局 / BGP / OSPFv2 / OSPFv3 / RIP / RIPng / IS-IS / EIGRP /
  Babel / PIM / LDP / Segment-Routing / VRRP / BFD / 原始配置，共 15 个标签，
  协议内部再分子标签（如 BGP：基本 / 邻居 / 宣告网段 / 路由重发布 / 聚合）。
- **UCI 单一事实来源**：所有设置写入 `/etc/config/frr`，`frr-uci-export` 生成器渲染出
  `frr.conf` 与 `daemons`。手工编辑 frr.conf 的内容会在下次保存时被覆盖。
- **未安装的协议自动跳过**：生成器按 `/usr/sbin/` 下是否存在对应守护进程二进制决定
  是否输出该协议配置、是否启用该 daemon——装了 `frr-bgp` 才有 BGP，没装不报错。
- **实时状态**：服务状态（vtysh 版本横幅）、13 协议"界面配置 × 守护进程运行"状态矩阵、
  IPv4/IPv6 路由表格式化展示（协议/目的网段/距离/度量/下一跳/出接口 6 列）。
- **接口下拉**：所有需要填接口名的地方（单值或多选）自动列举本机 `/sys/class/net` 接口。
- **原始配置兜底**：NHRP、PBR、FabricD 等未单独建模的协议，用"其他协议（原始配置）"
  标签逐行输入 vtysh 命令，每行一条，缩进保留。

## 支持的协议与生成内容

| 标签            | UCI section                                              | 守护进程      | 生成配置块                                                                                      |
| --------------- | -------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------- |
| 全局            | `global`                                                 | —             | hostname / log syslog / daemons 总开关                                                          |
| BGP             | `bgp` + `bgp_neighbor` + `bgp_aggregate`                 | bgpd          | `router bgp`（v4/v6 地址族、邻居、聚合、重发布）                                                |
| OSPFv2          | `ospf` + `ospf_area` + `ospf_network` + `ospf_interface` | ospfd         | `router ospf` + `interface` 块（cost/网络类型/认证）                                            |
| OSPFv3          | `ospf6`                                                  | ospf6d        | `router ospf6`                                                                                  |
| RIP / RIPng     | `rip` / `ripng` + `rip_interface`                        | ripd / ripngd | `router rip(ng)`（版本/定时器/认证/被动接口）                                                   |
| IS-IS           | `isis` + `isis_interface`                                | isisd         | `router isis` + `interface` 块（net/is-type/metric-style/SR）                                   |
| EIGRP           | `eigrp`                                                  | eigrpd        | `router eigrp`（network/passive-interface/distance/variance）                                   |
| Babel           | `babel` + `babel_interface`                              | babeld        | `router babel` + `interface` 块（wired/wireless）                                               |
| PIM             | `pim` / `pim6` + `pim_interface`                         | pimd / pim6d  | `router pim(6)` + `interface` 块（ip pim/ip igmp）                                              |
| LDP             | `ldp`                                                    | ldpd          | `mpls ldp`（router-id/address-family/interface）                                                |
| Segment-Routing | `sr` + `sr_prefix` + `sr_seglist` + `sr_policy`          | isisd + pathd | IS-IS 内 `segment-routing`（SRGB/Prefix SID）+ pathd `traffic-eng`（SR-TE Policy/Segment-List） |
| VRRP            | `vrrp`（多实例）                                         | vrrpd         | `interface` 块 `vrrp` 命令族                                                                    |
| BFD             | `bfd`（多实例）                                          | bfdd          | `peer` 块（检测定时器/乘数）                                                                    |
| 其他协议        | `raw`（多段）                                            | 任意          | 逐行透传 vtysh 配置                                                                             |

> 邻接 SID 说明：FRR 不支持手工指派邻接 SID，界面通过 Segment-List 的
> `nai adjacency <邻接器> <下一跳>` 条目引用，与官方行为一致。

## 安装

### 依赖

- OpenWrt 21.02+ / ImmortalWrt（LuCI 21.x 传统 `'require'` 脚本风格，非 ES module）
- FRR 软件包（`frr`、`frr-zebra`、`frr-watchfrr`、`frr-staticd`，按需加 `frr-bgp` 等）

### 从 ipk/apk 安装

```sh
# 编译（见下节）后，把 luci-app-frr-*.apk 拷到路由器：
apk add --allow-untrusted /tmp/luci-app-frr-1.0.0-r1.apk
# 或旧版 opkg：
opkg install luci-app-frr_1.0.0-r1_all.ipk
```

浏览器打开 **网络 → FRR 动态路由**（`/cgi-bin/luci/admin/network/frr`）。

### 从源码编译（OpenWrt SDK）

```sh
tar xzf openwrt-sdk-*.tar.xz && cd openwrt-sdk-*
./scripts/feeds update -i   # 需要 luci.mk
mkdir -p package/luci-app-frr
tar xzf /path/to/luci-app-frr.tgz -C package/luci-app-frr
make package/luci-app-frr/compile -j4
# 产物：bin/packages/<arch>/base/luci-app-frr-*.apk
```

### 手工部署（无编译环境时）

把 `root/` 与 `htdocs/` 内容按路径合并到路由器文件系统：

```
root/etc/config/frr                    -> /etc/config/frr          （仅首次）
root/usr/sbin/frr-uci-export           -> /usr/sbin/  + chmod +x
root/usr/sbin/frr-status               -> /usr/sbin/  + chmod +x
root/usr/share/luci/menu.d/*.json      -> /usr/share/luci/menu.d/
root/usr/share/rpcd/acl.d/*.json       -> /usr/share/rpcd/acl.d/   然后 /etc/init.d/rpcd restart
htdocs/luci-static/resources/...       -> /www/luci-static/resources/...
```

## 使用流程

1. 「全局」勾选 **启用 FRR**，填主机名/日志级别。
2. 进入协议标签填参数，需要接口的地方从下拉选择。
3. 点 **保存并应用** → 界面自动执行 `frr-uci-export`：写 `/etc/frr/{daemons,frr.conf}`
   并 `service frr restart`。
4. 回到「全局」标签查看状态矩阵与路由表确认生效。

命令行等价操作（调试用）：

```sh
/usr/sbin/frr-uci-export --stdout   # 预览将生成的 frr.conf，不落盘
/usr/sbin/frr-uci-export --check    # 已安装文件与 UCI 是否一致（exit 1 = 不一致）
frr-uci-export                      # 写入并重载
/usr/sbin/frr-status                # 状态快照（带硬超时，见"设计要点"）
```

## 目录结构

```
Makefile                                  # OpenWrt 包定义（luci.mk）
root/
  etc/config/frr                          # UCI 默认配置骨架（全部 section 预置）
  usr/sbin/frr-uci-export                 # UCI -> frr.conf/daemons 生成器（POSIX sh）
  usr/sbin/frr-status                     # 一次性状态快照（vtysh 硬超时包装）
  usr/share/luci/menu.d/luci-app-frr.json # 菜单：网络 → FRR 动态路由
  usr/share/rpcd/acl.d/luci-app-frr.json  # ACL：uci frr 读写 + file.exec 白名单
htdocs/luci-static/resources/
  frr.css                                 # 栏位加宽 / 表格撑满页面 / 列宽分配
  view/frr/api.js                         # apply/status/vtysh/ifaces + m.save() 挂钩
  view/frr/main.js                        # 单页标签式主界面（15 标签）
DESIGN.md                                 # 软件设计稿（架构与决策记录）
```

## 设计要点与踩坑记录

这些是实测（ImmortalWrt 25.12.1 / LuCI 26.187 / FRR 10.4.1）得出的硬约束，改动前必读：

- **load() 里绝不能调 vtysh**。rpcd 是单线程的，vtysh 在守护进程 socket 半开时会无限挂起，
  一个挂起的 `file.exec` 子进程会堵死所有 RPC（包括 uci.load），整页瘫痪。
  对策：① `load()` 只做 `uci.load` + `/bin/ls /sys/class/net`（都永不挂）；
  ② 状态数据由 `frr-status` 包装脚本采集，内部对每条 vtysh 用"后台 + 看门狗 kill"实现
  3 秒硬超时（BusyBox 没有 `timeout` applet）；③ 看门狗子进程必须
  `</dev/null >/dev/null` 脱钩——否则孤儿 `sleep` 占住 rpcd 的 stdout 管道，
  `file.exec` 等不到 EOF，同样堵死 rpcd；④ 前端对 status 再套 12 秒 JS 竞速兜底；
  ⑤ vtysh 全挂时按 `/var/run/frr/*.pid` 判定运行状态（PIDS 段）。
- **rpcd `file.exec` 的 ACL 键是完整命令行**，形如 `"/usr/bin/vtysh -c *": ["exec"]`；
  不匹配时返回 code 6（PERMISSION_DENIED），CLI 直接 ubus 调用则不受 ACL 限制——
  排查时别被 CLI 测试结果误导。
- **本机 LuCI form.js 没有 `onaftersave`**，保存挂钩用包装 `m.save()` 实现（api.js bindApply）。
- **`rpc.declare({...})` 返回函数，必须立即 `()` 调用**。
- **视图模块返回值必须是 `L.Class.extend({})`**，裸 `class` 会被 require 校验拒绝。
- **section 对象不支持 `.depends()`**（只有 option 支持）；本界面按用户要求不做隐藏式联动，
  卡片常显。
- **BGP 两个坑**：FRR 10.x `ebgp-requires-policy` 默认开启会静默丢弃全部 eBGP 更新，
  生成器固定输出 `no bgp ebgp-requires-policy`；邻居 `activate` 需要
  `bgp default ipv4-unicast` 才能按预期建会话。
- **`service frr reload` 在 10.4.1 上与 watchfrr 竞争**可能杀死守护进程，
  生成器一律 `restart`（脚本内有 ponytail 注释）。
- **Windows 上编辑的 shell/JS 文件必须 LF 换行**，CRLF 会打断 shebang。
- **material 主题把 input 包在额外 div 里**，CSS 用后代选择器（`.cbi-value-field input.cbi-input-text`），
  `>` 子选择器不命中。

## 测试

```sh
sh scripts/test-export.sh
# stub uci + 假二进制，断言生成的 frr.conf/daemons 关键行，输出 == ALL PASSED ==
```

端到端回归（两台路由器组网，见 research/setup_neighbor.sh、research/verify.sh）：
BGP/OSPF/RIP 三协议邻居建立与路由互学，`vtysh -b` 零错误。

## 已知限制

- 路由策略（route-map/prefix-list/access-list）未建模——用「其他协议（原始配置）」标签
  逐行输入，或继续 vtysh。需要时再按协议补 section。
- 状态展示为手动刷新（进页面时拉取一次）；需要自动轮询时在 fillStatus 加 setInterval 即可。
- 界面文案直接内嵌中文，无 po 翻译层（部署环境只有中文用户）。

## 许可

与 FRR / OpenWrt 生态一致（ISC / GPL-2.0）。
