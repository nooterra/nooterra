FROM python:3.12-slim

WORKDIR /app

COPY services/ml-sidecar/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY services/ml-sidecar/src ./src
COPY services/ml-sidecar/railway.toml ./railway.toml

EXPOSE 8100

CMD uvicorn src.server:app --host 0.0.0.0 --port ${PORT:-8100}
