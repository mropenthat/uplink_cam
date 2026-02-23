import json
import requests


def verify_database():
    print("[GHOST] Running health check on all camera nodes...")
    with open("cams.json", "r") as f:
        cams = json.load(f)

    active_cams = []
    for cam in cams:
        try:
            res = requests.get(cam["url"], timeout=5, stream=True)
            if res.status_code == 200:
                active_cams.append(cam)
                res.close()
            else:
                print(
                    f"[DROPPED] Node {cam['id']} offline (Status {res.status_code})"
                )
        except requests.RequestException as e:
            print(f"[DROPPED] Node {cam['id']} — {e}")

    with open("cams.json", "w") as f:
        json.dump(active_cams, f, indent=4)
    print(f"[GHOST] Cleanup complete. {len(active_cams)} healthy nodes remain.")


if __name__ == "__main__":
    verify_database()
