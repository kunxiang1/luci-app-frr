include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for FRR routing suite
LUCI_DEPENDS:=+frr +frr-zebra +frr-watchfrr +frr-staticd
LUCI_PKGARCH:=all
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

include $(TOPDIR)/feeds/luci/luci.mk

# Windows-made tarballs lose unix exec bits; ensure the generator scripts are
# executable inside the package (build-time) and on install/upgrade (postinst).
define Build/Configure
	chmod 0755 $(PKG_BUILD_DIR)/root/usr/sbin/frr-uci-export \
	           $(PKG_BUILD_DIR)/root/usr/sbin/frr-status
endef

define Package/luci-app-frr/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	chmod 0755 /usr/sbin/frr-uci-export /usr/sbin/frr-status 2>/dev/null
	rm -f /tmp/luci-indexcache.*
	rm -rf /tmp/luci-modulecache/
	/etc/init.d/rpcd reload 2>/dev/null
	exit 0
}
endef

# call BuildPackage - OpenWrt buildroot signature
