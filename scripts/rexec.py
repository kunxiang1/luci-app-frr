"""Remote exec helper for the phantun build box (192.168.234.250, frank/123)."""
import paramiko, sys

HOST, USER, PW = "192.168.234.250", "frank", "123"

def run(cmd, timeout=120):
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PW, timeout=15)
    _, out, err = c.exec_command(cmd, timeout=timeout)
    o = out.read().decode(errors="replace")
    e = err.read().decode(errors="replace")
    rc = out.channel.recv_exit_status()
    c.close()
    return rc, o, e

def put(local, remote):
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PW, timeout=15)
    c.open_sftp().put(local, remote)
    c.close()

if __name__ == "__main__":
    rc, o, e = run(sys.argv[1])
    print(o)
    if e: print("STDERR:", e, file=sys.stderr)
    sys.exit(rc)
