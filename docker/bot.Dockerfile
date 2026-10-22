# The sandbox image: compilers and runtimes for players' bots (C++17, Java, Python 3).
# The server starts one short-lived container from it per compile and per bot process, with no
# network, limited memory / CPU / processes, a read-only filesystem and the nobody user.
FROM debian:bookworm-slim

# (the JDK's install scripts expect the man directory, which slim images leave out)
RUN mkdir -p /usr/share/man/man1 \
 && apt-get update \
 && apt-get install -y --no-install-recommends g++ libc6-dev openjdk-17-jdk-headless python3 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /bot
USER 65534:65534
