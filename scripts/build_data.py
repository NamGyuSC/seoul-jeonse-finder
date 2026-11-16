"""원본 실거래 CSV에서 전세·반전세 거래만 골라 웹페이지용 가벼운 JSON을 만든다.

- 전세: deal_type == "전세"
- 반전세: deal_type == "월세" 이면서 보증금이 SEMI_MIN(1억) 이상인 거래

사용법 (프로젝트 폴더에서):
    python scripts/build_data.py

입력: data/raw/seoul-apt-latest.csv
출력: data/jeonse.json
"""
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "raw" / "seoul-apt-latest.csv"
OUT = ROOT / "data" / "jeonse.json"

# 화면의 보증금 슬라이더 최대값(5억, 만 원 단위)보다 비싼 거래는 미리 뺀다.
MAX_DEPOSIT = 50000
# 월세 거래 중 보증금이 이 금액(1억, 만 원 단위) 이상이면 반전세로 본다.
SEMI_MIN = 10000


def main():
    sys.stdout.reconfigure(encoding="utf-8")  # Windows 콘솔에서 한글 깨짐 방지
    complexes = {}   # (gu, dong, name) -> index
    # t: 0=전세 1=반전세, r: 월세(만 원)
    deals = {"c": [], "m": [], "d": [], "a": [], "f": [], "p": [], "t": [], "r": []}
    months = set()

    with SRC.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["deal_type"] not in ("전세", "월세") or not row["deposit"]:
                continue
            deposit = int(float(row["deposit"]))
            if deposit > MAX_DEPOSIT:
                continue
            semi = row["deal_type"] == "월세"
            if semi and deposit < SEMI_MIN:
                continue
            key = (row["gu"], row["dong"], row["complex"])
            idx = complexes.setdefault(key, len(complexes))
            ym = row["contract_ym"]
            months.add(ym)
            deals["c"].append(idx)
            deals["m"].append(ym)
            deals["d"].append(int(row["contract_date"][-2:]))  # 계약 '일'
            deals["a"].append(round(float(row["area_m2"]) * 10))  # ㎡ x10 정수
            deals["f"].append(int(float(row["floor"] or 0)))
            deals["p"].append(deposit)
            deals["t"].append(1 if semi else 0)
            deals["r"].append(int(float(row["monthly_rent"] or 0)) if semi else 0)

    month_list = sorted(months)
    month_idx = {m: i for i, m in enumerate(month_list)}
    deals["m"] = [month_idx[m] for m in deals["m"]]

    out = {
        "source": "국토교통부 아파트 전월세 실거래 (seoul-apt-latest.csv)",
        "semiMin": SEMI_MIN,
        "months": month_list,
        "complexes": [list(k) for k in sorted(complexes, key=complexes.get)],
        "deals": deals,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    semi_n = sum(deals["t"])
    print(f"전세 {len(deals['p']) - semi_n:,}건, 반전세 {semi_n:,}건, 단지 {len(complexes):,}개 -> {OUT} "
          f"({OUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
