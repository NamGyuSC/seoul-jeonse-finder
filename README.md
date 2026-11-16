# 신혼집 전세 탐색기

서울 아파트 전세·반전세(보증금 1억 이상 월세) 실거래를 보증금·면적·구별로 살펴보는 정적 웹페이지. 기획은 [PRD.md](PRD.md) 참고.

## 파일 구성
| 파일 | 역할 |
|---|---|
| `index.html` | 페이지 뼈대 |
| `style.css` | 디자인 (휴대폰·다크 모드 대응) |
| `app.js` | 필터·지도·그래프·목록 동작 |
| `data/jeonse.json` | 화면에서 쓰는 전세·반전세 데이터 (보증금 5억 이하, 약 3.2MB) |
| `data/seoul-gu.geojson` | 서울 25개 구 경계 |
| `data/infra.json` | 구별 인프라 설명 문구 (초안 — 여기만 고치면 화면 문구가 바뀜) |

지도는 OpenStreetMap 타일을 [Leaflet](https://leafletjs.com/)(cdnjs에서 불러옴)으로 표시해요.
| `scripts/build_data.py` | 원본 CSV → `data/jeonse.json` 변환 |
| `data/raw/` | 원본 CSV (27MB, GitHub에는 올리지 않음) |

## 내 PC에서 열기
`index.html`을 더블클릭하면 데이터를 못 불러와요. 프로젝트 폴더에서 아래 명령으로 간이 서버를 켠 뒤 브라우저에서 http://localhost:8000 을 여세요.

```bash
python -m http.server 8000
```

## 데이터 다시 만들기
```bash
python scripts/build_data.py
```
