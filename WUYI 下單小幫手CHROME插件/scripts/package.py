import os
import zipfile

def package_extension():
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    dist_dir = os.path.join(root_dir, "dist")
    os.makedirs(dist_dir, exist_ok=True)
    zip_path = os.path.join(dist_dir, "wuyi-order-helper.zip")

    files_and_dirs_to_include = [
        "manifest.json",
        "rules.json",
        "src",
        "google-apps-script"
    ]

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
        for item in files_and_dirs_to_include:
            item_path = os.path.join(root_dir, item)
            if os.path.isfile(item_path):
                zipf.write(item_path, arcname=item)
            elif os.path.isdir(item_path):
                for root, _, files in os.walk(item_path):
                    for file in files:
                        if not file.startswith(".") and not file.endswith(".pyc"):
                            full_p = os.path.join(root, file)
                            rel_p = os.path.relpath(full_p, root_dir)
                            zipf.write(full_p, arcname=rel_p)

    print(f"✅ Packaged successfully to: {zip_path}")
    print(f"📦 Archive size: {os.path.getsize(zip_path)} bytes")

if __name__ == "__main__":
    package_extension()
