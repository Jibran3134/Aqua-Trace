FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MPLCONFIGDIR=/tmp/matplotlib
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && groupadd --gid 10001 aquatrace \
    && useradd --uid 10001 --gid 10001 --no-create-home aquatrace
COPY --chown=10001:10001 app ./app
COPY --chown=10001:10001 data ./data
COPY --chown=10001:10001 alembic ./alembic
COPY --chown=10001:10001 alembic.ini ./
COPY --chown=10001:10001 config ./config
RUN mkdir -p /app/cache && chown -R 10001:10001 /app/cache
USER 10001:10001
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-proxy-headers"]
