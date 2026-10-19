"""Opt-in browser regression. Every management response is synthetic; no model calls."""

import argparse
import json
import os
import time
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import sync_playwright

args = argparse.ArgumentParser()
args.add_argument("--url", default="http://127.0.0.1:5173/")
args.add_argument("--tag", default="layout")
args.add_argument("--output", type=Path, required=True)
args.add_argument("--assert-fixed", action="store_true")
opt = args.parse_args()
OUT = opt.output
OUT.mkdir(parents=True, exist_ok=True)
rows = [
    {
        "id": f"fixture-{i:03}",
        "timestamp": "2026-10-19T03:44:21Z",
        "url": "/v1/responses",
        "method": "POST",
        "model": "example-model",
        "provider": "Example provider",
        "ip": "127.0.0.1",
        "success": i % 4 != 0,
        "status": 200 if i % 4 else 500,
        "called_tools_preview": "exec_command",
        "system_prompt_preview": "Synthetic system prompt",
        "prompt_preview": "Synthetic request summary",
        "output_preview": f"Row {i:03} sample output",
        "error_preview": "" if i % 4 else "Synthetic error",
    }
    for i in range(30)
]
requests, unexpected = [], []


def fixture(route):
    request = route.request
    url = urlsplit(request.url)
    if "/management/" not in url.path:
        if url.path.startswith("/v1/") or url.hostname not in {
            "127.0.0.1",
            "localhost",
        }:
            unexpected.append({"method": request.method, "path": url.path})
            return route.fulfill(
                status=500,
                json={"error": "Model requests are outside this browser fixture"},
            )
        return route.continue_()
    path = url.path.split("/management/", 1)[1]
    if request.method != "GET":
        unexpected.append({"method": request.method, "path": path})
        return route.fulfill(status=405, json={})
    status = 200
    if path == "config":
        data = {
            "config-version": 8,
            "observability": {"logs": {"request-log": True, "logging-to-file": True}},
            "request-log-retention-days": 7,
        }
    elif path == "nodes":
        status, data = 404, {}
    elif path == "request-logs":
        q = parse_qs(url.query).get("q", [""])[0]
        requests.append({"q": q, "at": time.monotonic()})
        data = {
            "items": rows,
            "total": 14738,
            "limit": 30,
            "offset": 0,
            "retention_days": 7,
            "syncing": False,
            "last_synced_at": "2026-10-19T03:44:21Z",
            "storage": "sqlite",
        }
    elif path == "observability/logs":
        data = {"lines": [], "latest-timestamp": 0}
    elif path == "request-log-retention-days":
        data = {"request-log-retention-days": 7}
    elif path in ["plugins", "usage", "api-keys", "server/latest-version"]:
        data = {}
    else:
        data = {}
    route.fulfill(
        status=status,
        json=data,
        headers={
            "X-CPA-Version": "fixture",
            "X-CPA-Commit": "fixture",
            "X-CPA-Support-Plugin": "1",
        },
    )


with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path=os.environ.get("CPA_BROWSER_EXECUTABLE"),
        headless=True,
        args=["--no-sandbox"],
    )
    context = browser.new_context(
        viewport={"width": 1445, "height": 950}, locale="zh-CN"
    )
    context.route("**/*", fixture)
    context.add_init_script(
        """(() => { localStorage.setItem('isLoggedIn', 'true'); localStorage.setItem('apiBase', JSON.stringify(location.origin)); localStorage.setItem('managementKey', JSON.stringify('fixture-management-key')); })()"""
    )
    page = context.new_page()
    page_errors = []
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.goto(opt.url + "#/logs", wait_until="networkidle")
    tab = page.get_by_role("button", name="请求日志", exact=True)
    try:
        tab.wait_for(timeout=10000)
    except Exception:
        print("PAGE_STATE", page.url, page.locator("body").inner_text()[:750])
        raise
    tab.click()
    page.locator("table tbody tr").first.wait_for()
    page.wait_for_timeout(350)
    report = {"cases": [], "unexpected_requests": unexpected}
    for w, h in [
        (1445, 950),
        (1366, 768),
        (1024, 768),
        (768, 720),
        (390, 844),
        (1024, 600),
    ]:
        page.set_viewport_size({"width": w, "height": h})
        page.wait_for_timeout(130)
        data = page.evaluate("""() => {
          const table = document.querySelector('table');
          const wrap = table.parentElement;
          const card = wrap.closest('.card') || wrap.parentElement.parentElement;
          const box = el => {const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,overflowY:getComputedStyle(el).overflowY,overflowX:getComputedStyle(el).overflowX}};
          const controls=[...document.querySelectorAll('button')].filter(e=>e.textContent.trim()==='下一页').map(box);
          wrap.scrollTop=wrap.scrollHeight;
          wrap.scrollLeft=0;
          const last=table.querySelector('tbody tr:last-child');
          const button=last.querySelector('button');
          const initialAction=box(button);
          const hit = document.elementFromPoint(initialAction.x+initialAction.width/2, initialAction.y+initialAction.height/2);
          const actionAtStartVisible=initialAction.x>=box(wrap).x && initialAction.right<=box(wrap).right && (hit===button || button.contains(hit));
          wrap.scrollLeft=wrap.scrollWidth;
          return {actionAtStartVisible,viewport:{width:innerWidth,height:innerHeight},wrap:box(wrap),card:box(card),table:box(table),lastRow:box(last),lastAction:box(last.querySelector("button")),header:box(table.querySelector("thead")),pagination:controls,documentHeight:document.documentElement.scrollHeight,documentWidth:document.documentElement.scrollWidth,wrapClass:wrap.className,cardClass:card.className,ancestors:(()=>{let e=card;const a=[];for(let i=0;e&&i<5;i++,e=e.parentElement)a.push({tag:e.tagName,class:e.className,...box(e)});return a})()};
        }""")
        data["contained"] = (
            data["card"]["bottom"] <= h + 1 and data["wrap"]["bottom"] <= h + 1
        )
        data["usable_table_height"] = (
            data["wrap"]["clientHeight"]
            >= data["header"]["height"] + 2 * data["lastRow"]["height"]
        )
        data["last_row_reachable"] = (
            data["lastRow"]["bottom"] <= min(h, data["wrap"]["bottom"]) + 1
            and data["lastRow"]["y"] >= data["header"]["bottom"] - 1
        )
        data["action_reachable"] = (
            data["lastAction"]["x"] >= data["wrap"]["x"]
            and data["lastAction"]["right"] <= min(w, data["wrap"]["right"])
            and data["lastAction"]["bottom"] <= min(h, data["wrap"]["bottom"])
        )
        visible_pagination = [x for x in data["pagination"] if x["height"] > 0]
        data["pagination_reachable"] = bool(visible_pagination) and all(
            x["bottom"] <= min(h, data["card"]["bottom"]) + 1
            and x["right"] <= min(w, data["card"]["right"]) + 1
            for x in visible_pagination
        )
        data["no_page_overflow"] = (
            data["documentWidth"] <= w and data["documentHeight"] <= h
        )
        report["cases"].append(data)
        page.screenshot(path=str(OUT / f"{opt.tag}-{w}x{h}.png"))
    report["requests"] = [{"q": x["q"]} for x in requests]
    report["page_errors"] = page_errors
    report["passed"] = (
        not page_errors
        and not unexpected
        and all(
            c["contained"]
            and c["actionAtStartVisible"]
            and c["usable_table_height"]
            and c["last_row_reachable"]
            and c["action_reachable"]
            and c["pagination_reachable"]
            and c["no_page_overflow"]
            for c in report["cases"]
        )
    )
    (OUT / f"{opt.tag}-browser.json").write_text(json.dumps(report, indent=2) + "\n")
    print(
        json.dumps(
            {
                "passed": report["passed"],
                "cases": [
                    {
                        k: v
                        for k, v in c.items()
                        if k
                        in [
                            "viewport",
                            "contained",
                            "last_row_reachable",
                            "pagination_reachable",
                            "usable_table_height",
                            "action_reachable",
                            "no_page_overflow",
                            "wrap",
                            "card",
                        ]
                    }
                    for c in report["cases"]
                ],
                "page_errors": page_errors,
                "unexpected_requests": unexpected,
            },
            indent=2,
        )
    )
    context.close()
    browser.close()
    if opt.assert_fixed and not report["passed"]:
        raise SystemExit(1)
