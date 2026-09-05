include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for FRR routing suite
LUCI_DEPENDS:=+frr +frr-zebra +frr-watchfrr +frr-staticd
LUCI_PKGARCH:=all
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
