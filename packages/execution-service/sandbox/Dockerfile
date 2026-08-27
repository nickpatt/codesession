# Sandbox runner image.
#
# This is the image every user's code runs inside. It is deliberately tiny and
# locked down: a slim Python base, a non-root user, and nothing else. The real
# isolation (no network, cpu/mem/pids caps, read-only fs, timeout) is applied by
# the execution-service at container-create time — but running as non-root and
# shipping no shells/tools we don't need is the first layer of defense.
FROM python:3.12-slim

# Create an unprivileged user. Even if code breaks out of the Python process,
# it has no root and no sudo inside the container.
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin runner

# Python niceties: don't buffer stdout (so output streams immediately) and don't
# write .pyc files (the rootfs is read-only at runtime anyway).
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Scratch space the runtime mounts as a writable tmpfs; user code may write here.
WORKDIR /scratch
RUN chown runner:runner /scratch

USER runner

# The container is started idle (kept warm in the pool). The execution-service
# injects each run via `docker exec python /scratch/main.py`, so the default
# command just keeps the container alive without consuming CPU.
CMD ["sleep", "infinity"]
