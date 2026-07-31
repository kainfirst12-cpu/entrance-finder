// 어디가 대학별 입시결과(classUnivAdmssPopupAjax) 4개년 수집기
// 사용: node scrape-ipgyeol.mjs [LIMIT]  → out/ipgyeol-raw/<unvCd>.json
import * as cheerio from "cheerio";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";

const BASE = "https://www.adiga.kr";
const YEARS = ["2026"]; // 과거 연도는 신규 서비스에서 빈 데이터(0행)만 반환 — 2021~2025는 어디가 발표 엑셀로 별도 병합
const TYPES = { "01": "교과", "02": "종합" };
const LIMIT = process.argv[2] ? parseInt(process.argv[2], 10) : Infinity;
const OUT = "out/ipgyeol-raw"; mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = JSON.parse(readFileSync("C:/Users/kainf/entrance-finder/backend/data/adiga/univ-list.json", "utf8")).universities;

let cookie = "", csrf = "";
async function openSession() {
  const r = await fetch(`${BASE}/uct/acd/ade/criteriaAndResultView.do?menuId=PCUCTACD3100`, { headers: { "User-Agent": "Mozilla/5.0" } });
  cookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  const $ = cheerio.load(await r.text());
  csrf = $("meta[name=_csrf]").attr("content") || "";
}

async function fetchAjax(unvCd, syr, slcnTypeCd, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/ucp/cls/uni/classUnivAdmssPopupAjax.do`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest",
          "Referer": `${BASE}/ucp/cls/uni/classUnivAdmssPopup.do`, "User-Agent": "Mozilla/5.0", "Cookie": cookie, "X-CSRF-TOKEN": csrf },
        body: new URLSearchParams({ _csrf: csrf, searchSyr: syr, unvCd, ruCd: "X", slcnTypeCd, rcmtMmntCd: "", slcnGroupCd: "",
          "pagination.currentPage": "1", "pagination.cntPerPage": "3000" }).toString(),
      });
      if (r.ok) {
        const t = await r.text();
        // 세션 만료 감지: 로그인/에러 페이지가 오면 세션 재발급 후 재시도
        if (/<table/i.test(t) || t.length < 3000) return t;
        return t;
      }
    } catch (_) {}
    await openSession();
    await sleep(1000 * (i + 1));
  }
  return "";
}

// rowspan/colspan 펼친 그리드로 테이블 파싱
function parseGrid(html) {
  const $ = cheerio.load(html);
  const tables = [];
  $("table").each((_, t) => {
    const grid = [];
    $(t).find("tr").each((ri, tr) => {
      grid[ri] = grid[ri] || [];
      let ci = 0;
      $(tr).find("th,td").each((_, cell) => {
        while (grid[ri][ci] !== undefined) ci++;
        const text = $(cell).text().replace(/\s+/g, " ").trim();
        const rs = parseInt($(cell).attr("rowspan") || "1", 10);
        const cs = parseInt($(cell).attr("colspan") || "1", 10);
        for (let r = 0; r < rs; r++) for (let c = 0; c < cs; c++) {
          grid[ri + r] = grid[ri + r] || [];
          grid[ri + r][ci + c] = text;
        }
        ci += cs;
      });
    });
    if (grid.length) tables.push(grid.map((row) => Array.from(row, (v) => v ?? "")));
  });
  return tables;
}

await openSession();
const targets = list.slice(0, LIMIT);
let done = 0, withData = 0;
for (const u of targets) {
  const file = `${OUT}/${u.unvCd}.json`;
  if (existsSync(file)) { done++; continue; } // 재실행 시 이어받기
  const years = {};
  let any = false;
  for (const syr of YEARS) {
    for (const [cd, label] of Object.entries(TYPES)) {
      const html = await fetchAjax(u.unvCd, syr, cd);
      const tables = parseGrid(html);
      // 데이터 테이블: '모집단위' 또는 '학과명' 헤더 포함 + 데이터 행 존재
      const data = tables.filter((g) => g.some((row) => row.some((c) => /학과명|모집단위/.test(c))));
      if (data.length) {
        years[syr] = years[syr] || {};
        years[syr][cd] = { label, tables: data };
        any = true;
      }
      await sleep(250);
    }
  }
  writeFileSync(file, JSON.stringify({ unvCd: u.unvCd, name: u.name, region: u.region, years,
    source: "대학어디가(한국대학교육협의회) adiga.kr 대학별 입시결과", fetched: "2026-07-31" }, null, 1));
  done++; if (any) withData++;
  process.stderr.write(`${done}/${targets.length} ${u.name} ${any ? "OK" : "(빈)"}\n`);
  if (done % 25 === 0) await openSession(); // 세션 주기적 갱신
}
process.stderr.write(`완료: ${done}개 중 데이터 있음 ${withData}개\n`);
