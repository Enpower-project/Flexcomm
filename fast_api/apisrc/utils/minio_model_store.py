"""
Upload trained models to MinIO and load them back.

MinIO bucket structure:
    models/{country}/{site}/{feature}/model_file
    scalers/{country}/{site}/{feature}/scaler_file

Features: tin_off, tin_on, rh

Usage:
    # Upload all local models for Hungary
    python minio_model_store.py upload --country hu --models-dir ./models

    # Upload a single site
    python minio_model_store.py upload --country hu --models-dir ./models --site df_1

    # List what's in the bucket
    python minio_model_store.py list

    # Download all models for a site into a local dir
    python minio_model_store.py download --country hu --site df_1 --out-dir ./downloaded_models
"""
from __future__ import annotations
import argparse
import io
import os
import tempfile
from pathlib import Path
import boto3
import joblib
from botocore.client import Config
from dotenv import load_dotenv

# ── Mapping from local filenames to MinIO feature paths ──────────────────────

MODEL_MAP = {
    # local_filename -> (category, feature, minio_filename)
    "best_model_v3.pt":  ("models",  "tin_off", "best_model_v3.pt"),
    "lgbm_heating.pkl":  ("models",  "tin_on",  "lgbm_heating.pkl"),
    "lgbm_cooling.pkl":  ("models",  "tin_on",  "lgbm_cooling.pkl"),
    "best_ah.pt":        ("models",  "rh",      "best_ah.pt"),
    "ah_features.json":  ("models",  "rh",      "ah_features.json"),
}

SCALER_MAP = {
    "scaler_v3.pkl": ("scalers", "tin_off", "scaler_v3.pkl"),
    "scaler_ah.pkl": ("scalers", "rh",      "scaler_ah.pkl"),
}


def get_s3_client():
    env_path = Path(__file__).resolve().parent.parent / ".env"
    load_dotenv(env_path)
    print("ENV PATH: ", env_path)
    print(os.getenv('HOST_URL'))
    return boto3.client(
        "s3",
        endpoint_url=f"{os.getenv('HOST_URL', 'localhost')}:{os.getenv('MINIO_PORT', '9000')}",
        aws_access_key_id=os.getenv("MINIO_ROOT_USER"),
        aws_secret_access_key=os.getenv("MINIO_ROOT_PASSWORD"),
        region_name="us-east-1",
        config=Config(
         signature_version="s3v4",
         connect_timeout=10,
         read_timeout=10,
         retries={"max_attempts": 1}
        ),
    )


def get_bucket():
    return os.getenv("BUCKET_NAME", "mlflow-bucket")


def ensure_bucket(s3, bucket: str):
    try:
        s3.head_bucket(Bucket=bucket)
    except s3.exceptions.ClientError:
        s3.create_bucket(Bucket=bucket)


# ── Upload ───────────────────────────────────────────────────────────────────

def upload_site(s3, bucket: str, country: str, site: str, models_dir: Path):
    site_dir = models_dir / site
    scaler_dir = models_dir / "scalers" / site

    uploaded = []

    # Models
    for filename, (category, feature, minio_name) in MODEL_MAP.items():
        local_path = site_dir / filename
        if not local_path.exists():
            print(f"  skip {filename} (not found)")
            continue
        key = f"{category}/{country}/{site}/{feature}/{minio_name}"
        s3.upload_file(str(local_path), bucket, key)
        uploaded.append(key)
        print(f"  -> {key}")

    # Scalers
    for filename, (category, feature, minio_name) in SCALER_MAP.items():
        local_path = scaler_dir / filename
        if not local_path.exists():
            print(f"  skip scalers/{filename} (not found)")
            continue
        key = f"{category}/{country}/{site}/{feature}/{minio_name}"
        s3.upload_file(str(local_path), bucket, key)
        uploaded.append(key)
        print(f"  -> {key}")

    return uploaded


def cmd_upload(args):
    s3 = get_s3_client()
    bucket = get_bucket()
    ensure_bucket(s3, bucket)

    models_dir = Path(args.models_dir).resolve()
    country = args.country

    if args.site:
        sites = [args.site]
    else:
        # Auto-discover: any df_* directory
        sites = sorted(
            d.name for d in models_dir.iterdir()
            if d.is_dir() and d.name.startswith("df_")
        )

    print(f"Bucket: {bucket}")
    print(f"Country: {country}")
    print(f"Sites: {sites}\n")

    for site in sites:
        print(f"[{site}]")
        upload_site(s3, bucket, country, site, models_dir)
        print()

    print("Upload complete.")


# ── List ─────────────────────────────────────────────────────────────────────

def cmd_list(args):
    s3 = get_s3_client()
    bucket = get_bucket()

    prefix = args.prefix or ""
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            print(f"  {obj['Key']}  ({obj['Size']} bytes)")


# ── Download ─────────────────────────────────────────────────────────────────

def cmd_download(args):
    s3 = get_s3_client()
    bucket = get_bucket()
    out_dir = Path(args.out_dir).resolve()

    prefix = f"models/{args.country}/{args.site}/"
    scaler_prefix = f"scalers/{args.country}/{args.site}/"

    for pfx in (prefix, scaler_prefix):
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=bucket, Prefix=pfx):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                local_path = out_dir / key
                local_path.parent.mkdir(parents=True, exist_ok=True)
                s3.download_file(bucket, key, str(local_path))
                print(f"  <- {key}")

    print(f"\nDownloaded to {out_dir}")


# ── Load models directly from MinIO into memory ─────────────────────────────

def load_bytes_from_minio(s3, bucket: str, key: str) -> bytes:
    response = s3.get_object(Bucket=bucket, Key=key)
    return response["Body"].read()


def load_pickle_from_minio(s3, bucket: str, key: str):
    data = load_bytes_from_minio(s3, bucket, key)
    return joblib.load(io.BytesIO(data))


def load_torch_from_minio(s3, bucket: str, key: str, device: str = "cpu"):
    import torch
    data = load_bytes_from_minio(s3, bucket, key)
    buf = io.BytesIO(data)
    return torch.load(buf, map_location=device, weights_only=True)


def load_json_from_minio(s3, bucket: str, key: str):
    import json
    data = load_bytes_from_minio(s3, bucket, key)
    return json.loads(data.decode("utf-8"))


def load_site_models(country: str, site: str, device: str = "cpu"):
    """
    Load all models and scalers for a site directly from MinIO into memory.

    Returns dict:
        {
            "tin_off": {"model_state": <state_dict>, "scaler": <scaler_obj>},
            "tin_on":  {"lgbm_heating": <model>, "lgbm_cooling": <model>},
            "rh":      {"model_state": <state_dict>, "scaler": <scaler_obj>, "features": <list>},
        }
    """
    s3 = get_s3_client()
    bucket = get_bucket()

    base_m = f"models/{country}/{site}"
    base_s = f"scalers/{country}/{site}"

    result = {
        "tin_off": {},
        "tin_on": {},
        "rh": {},
    }

    # tin_off
    result["tin_off"]["model_state"] = load_torch_from_minio(
        s3, bucket, f"{base_m}/tin_off/best_model_v3.pt", device
    )
    result["tin_off"]["scaler"] = load_pickle_from_minio(
        s3, bucket, f"{base_s}/tin_off/scaler_v3.pkl"
    )

    # tin_on (lgbm heating & cooling)
    result["tin_on"]["lgbm_heating"] = load_pickle_from_minio(
        s3, bucket, f"{base_m}/tin_on/lgbm_heating.pkl"
    )
    result["tin_on"]["lgbm_cooling"] = load_pickle_from_minio(
        s3, bucket, f"{base_m}/tin_on/lgbm_cooling.pkl"
    )

    # rh
    result["rh"]["model_state"] = load_torch_from_minio(
        s3, bucket, f"{base_m}/rh/best_ah.pt", device
    )
    result["rh"]["scaler"] = load_pickle_from_minio(
        s3, bucket, f"{base_s}/rh/scaler_ah.pkl"
    )
    result["rh"]["features"] = load_json_from_minio(
        s3, bucket, f"{base_m}/rh/ah_features.json"
    )

    return result


# ── CLI ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="MinIO model store for SCOT")
    sub = parser.add_subparsers(dest="command", required=True)

    # upload
    p_up = sub.add_parser("upload", help="Upload local models to MinIO")
    p_up.add_argument("--country", required=True, help="Country code, e.g. hu or gr")
    p_up.add_argument("--models-dir", required=True, help="Local models root directory")
    p_up.add_argument("--site", default=None, help="Single site to upload (e.g. df_1). Omit for all.")

    # list
    p_ls = sub.add_parser("list", help="List objects in the bucket")
    p_ls.add_argument("--prefix", default="", help="Filter by prefix")

    # download
    p_dl = sub.add_parser("download", help="Download models for a site")
    p_dl.add_argument("--country", required=True)
    p_dl.add_argument("--site", required=True)
    p_dl.add_argument("--out-dir", required=True)

    args = parser.parse_args()

    if args.command == "upload":
        cmd_upload(args)
    elif args.command == "list":
        cmd_list(args)
    elif args.command == "download":
        cmd_download(args)


if __name__ == "__main__":
    main()
