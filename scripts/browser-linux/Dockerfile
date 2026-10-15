FROM --platform=linux/386 i386/alpine:3.23.6

RUN apk add --no-cache alpine-base openrc agetty alpine-conf linux-virt linux-firmware-none bash curl wget ca-certificates ncurses-terminfo-base \
    && setup-hostname browser \
    && echo 'root:' | chpasswd \
    && sed -i '/^root:/s|/bin/sh$|/bin/bash|' /etc/passwd \
    && printf 'hostname="browser"\n' > /etc/conf.d/hostname \
    && printf 'ttyS0::respawn:/sbin/agetty --autologin root -s ttyS0 115200 xterm-256color\n' >> /etc/inittab \
    && printf 'hvc0::respawn:/sbin/agetty --autologin root hvc0 xterm-256color\n' >> /etc/inittab \
    && sed -i '/tty[1-6]::/d' /etc/inittab \
    && printf 'auto lo\niface lo inet loopback\nauto eth0\niface eth0 inet dhcp\n' > /etc/network/interfaces \
    && printf 'https://dl-cdn.alpinelinux.org/alpine/v3.23/main\nhttps://dl-cdn.alpinelinux.org/alpine/v3.23/community\n' > /etc/apk/repositories \
    && for service in devfs dmesg mdev hwdrivers; do rc-update add "$service" sysinit; done \
    && for service in modules sysctl hostname bootmisc networking; do rc-update add "$service" boot; done \
    && rc-update add killprocs shutdown \
    && mkinitfs -F 'base virtio 9p' "$(cat /usr/share/kernel/virt/kernel.release)"

COPY bash_profile /root/.bash_profile
RUN printf 'Welcome to Alpine Linux in your browser.\n\nTry: apk add fastfetch vim python3\n     curl https://example.com\n\n' > /etc/motd
