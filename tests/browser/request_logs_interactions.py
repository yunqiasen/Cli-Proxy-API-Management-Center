"""Opt-in request log interaction checks against Vite, using only synthetic APIs."""

import argparse
import asyncio
import json
import os
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from playwright.async_api import Error as PlaywrightError
from playwright.async_api import async_playwright, expect

INIT = """(() => {
  localStorage.setItem('isLoggedIn', 'true');
  localStorage.setItem('apiBase', JSON.stringify(location.origin));
  localStorage.setItem('managementKey', JSON.stringify('fixture-management-key'));
  // Drive the panel's refresh interval explicitly; debounce and animations use real time.
  const set = window.setInterval.bind(window), clear = window.clearInterval.bind(window);
  const timers = new Map(); let id = -1;
  window.setInterval = (fn, ms, ...args) => {
    if (ms !== 5000) return set(fn, ms, ...args);
    timers.set(--id, () => fn(...args)); return id;
  };
  window.clearInterval = id => { if (!timers.delete(id)) clear(id); };
  window.fixtureRefresh = () => [...timers.values()].forEach(fn => fn());
})()"""


def row(i, query=""):
    return {
        "id": f"fixture-{i:03}",
        "timestamp": "2026-10-19T03:44:21Z",
        "url": "/v1/responses",
        "method": "POST",
        "model": "example-model",
        "provider": "Example provider",
        "ip": "127.0.0.1",
        "success": True,
        "status": 200,
        "called_tools_preview": "exec_command",
        "prompt_preview": "Synthetic request",
        "output_preview": f"{query or 'all'} row {i:03}",
    }


class Fixture:
    def __init__(self):
        self.lists = []
        self.exports = []
        self.unexpected = []
        self.gates = {}
        self.arrived = set()
        self.completed = set()

    def hold(self, key):
        self.gates[key] = asyncio.Event()

    def release(self, key):
        self.gates[key].set()

    async def route(self, route):
        req = route.request
        url = urlsplit(req.url)
        if "/management/" not in url.path:
            if url.path.startswith("/v1/") or url.hostname not in {
                "127.0.0.1",
                "localhost",
            }:
                self.unexpected.append({"method": req.method, "path": url.path})
                return await route.fulfill(status=400, json={})
            return await route.continue_()
        path = url.path.split("/management/", 1)[1]
        if req.method != "GET":
            self.unexpected.append({"method": req.method, "path": path})
            return await route.fulfill(status=405, json={})
        params = {key: value[0] for key, value in parse_qs(url.query).items()}
        code, data, key = 200, {}, None
        if path == "config":
            data = {
                "config-version": 8,
                "observability": {
                    "logs": {"request-log": True, "logging-to-file": True}
                },
            }
        elif path == "nodes":
            code = 404
        elif path == "request-logs":
            query, offset = params.get("q", ""), int(params.get("offset", 0))
            self.lists.append({"q": query, "offset": offset})
            key = "list:" + query
            data = {
                "items": [row(i, query) for i in range(offset, offset + 30)],
                "total": 120,
                "limit": 30,
                "offset": offset,
                "syncing": False,
                "retention_days": 7,
                "storage": "sqlite",
            }
            if query == "empty":
                data.update(items=[], total=0)
            if query == "old-error":
                code, data = 500, {"error": "stale fixture error"}
        elif path == "request-logs/export":
            self.exports.append(params)
            return await route.fulfill(status=200, body="synthetic export\n")
        elif path.startswith("request-logs/"):
            entry_id = path.split("/", 1)[1]
            key = "detail:" + entry_id
            data = {
                **row(int(entry_id.rsplit("-", 1)[1])),
                "prompt": "detail " + entry_id,
                "output": "Synthetic full output",
            }
        elif path == "observability/logs":
            data = {
                "lines": [
                    f"[2026-10-19 11:44:21] [info ] [main.go:1] RAW fixture {i:03}"
                    for i in range(80)
                ],
                "latest-timestamp": 1792381461,
            }
        elif path == "observability/logs/errors":
            data = {
                "files": [
                    {
                        "name": f"error-fixture-{i:03}.log",
                        "size": 100,
                        "modified": 1792381461,
                    }
                    for i in range(80)
                ]
            }
        elif path.startswith("observability/logs/errors/"):
            return await route.fulfill(status=200, body="Synthetic error log body")
        if key:
            self.arrived.add(key)
            if key in self.gates:
                await self.gates[key].wait()
        try:
            await route.fulfill(
                status=code,
                json=data,
                headers={"X-CPA-Version": "fixture", "X-CPA-Commit": "fixture"},
            )
        finally:
            if key:
                self.completed.add(key)


async def wait_for(predicate):
    for _ in range(300):
        if predicate():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("fixture condition did not settle")


async def settle(page):
    await page.wait_for_timeout(100)


async def typing(page, fixture):
    field = page.get_by_placeholder("搜索时间、模型、工具、系统提示词、错误、提示词")
    for value in ["e", "ex", "exec", "exec_command"]:
        await field.fill(value)
    await expect(field).to_have_value("exec_command")
    assert len(fixture.lists) == 1, "typing sent requests before debounce"
    await expect(page.locator("tbody tr").first).to_contain_text("exec_command row 000")
    assert [req["q"] for req in fixture.lists] == ["", "exec_command"]


async def latest_search(page, fixture):
    field = page.get_by_placeholder("搜索时间、模型、工具、系统提示词、错误、提示词")
    fixture.hold("list:slow")
    fixture.hold("list:old-error")
    await field.fill("slow")
    await wait_for(lambda: "list:slow" in fixture.arrived)
    await field.fill("old-error")
    await wait_for(lambda: "list:old-error" in fixture.arrived)
    await field.fill("newest")
    await expect(page.locator("tbody tr").first).to_contain_text("newest row 000")
    fixture.release("list:old-error")
    fixture.release("list:slow")
    await wait_for(lambda: {"list:slow", "list:old-error"} <= fixture.completed)
    await settle(page)
    await expect(page.locator("tbody tr").first).to_contain_text("newest row 000")
    await expect(page.get_by_text("stale fixture error", exact=False)).to_have_count(0)


async def reading_position(page, fixture):
    wrap = page.locator("table").locator("..")
    await wrap.evaluate("el => { el.scrollTop = 150; }")
    before = len(fixture.lists)
    await page.evaluate("fixtureRefresh()")
    await settle(page)
    assert len(fixture.lists) == before, (
        "automatic refresh replaced rows while reading below the top"
    )
    assert await wrap.evaluate("el => el.scrollTop") == 150
    await wrap.evaluate("el => { el.scrollTop = 0; }")
    await page.evaluate("fixtureRefresh()")
    await wait_for(lambda: len(fixture.lists) == before + 1)


async def pagination(page, fixture):
    wrap = page.locator("table").locator("..")
    await wrap.evaluate("el => { el.scrollTop = 150; }")
    await page.get_by_role("button", name="下一页", exact=True).last.click()
    await expect(page.locator("tbody tr").first).to_contain_text("all row 030")
    assert await wrap.evaluate("el => el.scrollTop") == 0
    before = len(fixture.lists)
    await page.evaluate("fixtureRefresh()")
    await settle(page)
    assert len(fixture.lists) == before, "background refresh moved a historical page"
    await page.get_by_placeholder(
        "搜索时间、模型、工具、系统提示词、错误、提示词"
    ).fill("filtered")
    await expect(page.locator("tbody tr").first).to_contain_text("filtered row 000")
    assert fixture.lists[-1] == {"q": "filtered", "offset": 0}


async def details(page, fixture):
    fixture.hold("detail:fixture-000")
    await page.get_by_role("button", name="预览", exact=True).first.click()
    await wait_for(lambda: "detail:fixture-000" in fixture.arrived)
    before = len(fixture.lists)
    await page.evaluate("fixtureRefresh()")
    await settle(page)
    assert len(fixture.lists) == before, (
        "background refresh ran under the detail dialog"
    )
    await page.keyboard.press("Escape")
    await expect(page.get_by_role("dialog")).to_have_count(0)
    await page.get_by_role("button", name="预览", exact=True).nth(1).click()
    await expect(page.get_by_role("dialog")).to_contain_text("detail fixture-001")
    fixture.release("detail:fixture-000")
    await wait_for(lambda: "detail:fixture-000" in fixture.completed)
    await settle(page)
    await expect(page.get_by_role("dialog")).to_contain_text("detail fixture-001")
    await expect(page.get_by_role("dialog")).not_to_contain_text("detail fixture-000")
    await page.keyboard.press("Escape")
    await expect(page.get_by_role("dialog")).to_have_count(0)


async def switch_connection(page, fixture):
    field = page.get_by_placeholder("搜索时间、模型、工具、系统提示词、错误、提示词")
    await field.fill("pending-old-connection")
    await page.evaluate("""async () => {
      const { useAuthStore } = await import('/src/stores/useAuthStore.ts');
      useAuthStore.setState({ managementKey: 'fixture-next-key' });
    }""")
    await expect(field).to_have_value("")
    await page.wait_for_timeout(350)
    assert all(req["q"] != "pending-old-connection" for req in fixture.lists)
    await expect(page.locator("tbody tr").first).to_contain_text("all row 000")


async def export_and_empty(page, fixture):
    field = page.get_by_placeholder("搜索时间、模型、工具、系统提示词、错误、提示词")
    await field.fill("export-query")
    await expect(page.locator("tbody tr").first).to_contain_text("export-query row 000")
    await page.get_by_role("button", name="下一页", exact=True).last.click()
    await expect(page.locator("tbody tr").first).to_contain_text("export-query row 030")
    for label, fmt in [("导出 CSV", "csv"), ("导出 JSONL", "jsonl")]:
        async with page.expect_download():
            await page.get_by_role("button", name=label, exact=True).click()
        assert fixture.exports[-1] == {
            "q": "export-query",
            "limit": "30",
            "offset": "30",
            "pages": "1",
            "format": fmt,
        }
    await field.fill("empty")
    await expect(page.get_by_text("暂无请求日志", exact=True)).to_be_visible()
    await expect(page.locator("table")).to_have_count(0)


async def other_tabs(page, fixture):
    await page.get_by_role("button", name="日志内容", exact=True).click()
    await expect(page.get_by_text("RAW fixture 079", exact=False)).to_be_visible()
    await page.get_by_role("button", name="错误请求日志", exact=True).click()
    await expect(page.get_by_text("error-fixture-000.log", exact=True)).to_be_visible()
    await page.get_by_role("button", name="请求日志", exact=True).click()
    await expect(page.locator("tbody tr")).to_have_count(30)


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:5173/")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--skip-dev-store-check", action="store_true")
    opt = parser.parse_args()
    opt.output.mkdir(parents=True, exist_ok=True)
    results = []
    cases = [
        typing,
        latest_search,
        reading_position,
        pagination,
        details,
        export_and_empty,
        other_tabs,
    ]
    if not opt.skip_dev_store_check:
        cases.append(switch_connection)
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path=os.environ.get("CPA_BROWSER_EXECUTABLE"),
            headless=True,
            args=["--no-sandbox"],
        )
        for case in cases:
            context = await browser.new_context(
                viewport={"width": 1445, "height": 950}, locale="zh-CN"
            )
            fixture, errors = Fixture(), []
            await context.route("**/*", fixture.route)
            await context.add_init_script(INIT)
            page = await context.new_page()
            page.on("pageerror", lambda error, buffer=errors: buffer.append(str(error)))
            result = {"case": case.__name__, "passed": False}
            try:
                await page.goto(opt.url + "#/logs", wait_until="networkidle")
                await page.get_by_role("button", name="请求日志", exact=True).click()
                await expect(page.locator("tbody tr")).to_have_count(30)
                await case(page, fixture)
                assert not errors, errors
                assert not fixture.unexpected, fixture.unexpected
                result["passed"] = True
            except (AssertionError, PlaywrightError) as error:
                result["error"] = str(error)
                await page.screenshot(
                    path=str(opt.output / (case.__name__ + "-failed.png"))
                )
            finally:
                result.update(
                    requests=fixture.lists,
                    page_errors=errors,
                    unexpected=fixture.unexpected,
                )
                for gate in fixture.gates.values():
                    gate.set()
                await context.close()
            results.append(result)
            print(json.dumps(result, ensure_ascii=False), flush=True)
        await browser.close()
    (opt.output / "interactions.json").write_text(
        json.dumps(results, indent=2, ensure_ascii=False) + "\n"
    )
    if not all(result["passed"] for result in results):
        raise SystemExit(1)


asyncio.run(main())
