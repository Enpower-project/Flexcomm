FROM python:3.12.3-slim

RUN pip3 install --upgrade pip

# Dependencies first, so code changes don't invalidate this (heavy) layer.
# torch is installed from the CPU wheel index: ~200 MB instead of the
# multi-GB CUDA build, which the API does not need.
COPY ./requirements.txt /app/requirements.txt
RUN pip3 install --no-cache-dir torch==2.9.1 --index-url https://download.pytorch.org/whl/cpu \
    && pip3 install --no-cache-dir -r /app/requirements.txt

COPY ./apisrc /app/src

WORKDIR /app/src
ENV PYTHONPATH=/app/src
EXPOSE 8000

CMD ["uvicorn", "service:app", "--host", "0.0.0.0", "--port", "8000"]
