FROM python:3.12-slim
WORKDIR /worker
COPY worker.py /worker/worker.py
ENV PYTHONUNBUFFERED=1
ENTRYPOINT ["python", "/worker/worker.py"]
