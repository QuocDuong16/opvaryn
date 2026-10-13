#!/usr/bin/env python3
"""Rename pass for the OPVARYN playbook.

The playbook predates the naming decision: it still describes the product as an
unnamed "Business Process & Operations Platform". This script applies the
naming decision (technically settled: OPVARYN; commercial brand: provisional)
consistently across the HTML pages, the search index and the readme. Every
replacement asserts the expected occurrence count so a silent partial edit
cannot happen.
"""

from pathlib import Path

PLAYBOOK = Path(__file__).resolve().parents[1] / "operations-playbook"

HTML_PAGES = [
    "index.html",
    "modules.html",
    "architecture.html",
    "demo-mvp.html",
    "roadmap.html",
    "decisions.html",
    "notes.html",
]

# (old, new, expected total occurrences across HTML_PAGES)
SHARED_REPLACEMENTS = [
    (
        "Sổ tay offline cho dự án Business Process & Operations Platform: tầm nhìn, module, kiến trúc, kế hoạch, quyết định và ý tưởng.",
        "Sổ tay offline cho dự án OPVARYN (Business Process & Operations Platform): tầm nhìn, module, kiến trúc, kế hoạch, quyết định và ý tưởng.",
        7,
    ),
    (
        '<div class="brand-name">Operations Playbook</div>',
        '<div class="brand-name">OPVARYN Playbook</div>',
        7,
    ),
    (
        '<div class="brand-sub">Sổ tay chiến lược sản phẩm · v0.1</div>',
        '<div class="brand-sub">Sổ tay chiến lược sản phẩm · v0.2</div>',
        7,
    ),
    (
        "<br>Ý tưởng & kế hoạch ban đầu<br>Ngày ghi nhận: 13/10/2026",
        "<br>Tên kỹ thuật: OPVARYN (provisional)<br>Ý tưởng & kế hoạch ban đầu<br>Ngày ghi nhận: 13/10/2026",
        7,
    ),
    (
        "<span>Operations Playbook · Tài liệu ghi nhớ nội bộ, không phải demo phần mềm</span>",
        "<span>OPVARYN Playbook · Tài liệu ghi nhớ nội bộ, không phải demo phần mềm</span>",
        7,
    ),
]

NAMING_SECTION = """<section class="section" id="naming"><div class="section-header"><div><h2>00. Tên dự án: OPVARYN</h2><p class="section-sub">Tên kỹ thuật đã chốt tạm là OPVARYN, ghép từ Operations + Variability, nhấn mạnh khả năng tùy biến cách doanh nghiệp vận hành. Thương hiệu thương mại vẫn giữ trạng thái provisional.</p></div></div>
<div class="grid two">
<div class="card"><h3>Vì sao chọn tên này</h3><ul class="compact-list muted small"><li>Ngắn: 7 ký tự, dùng được cho repository, CLI, API và thương hiệu.</li><li>Không bó hẹp: phát triển Application Builder, Automation hay AI đều không cần đổi tên.</li><li>Đủ rộng để xây hệ sinh thái module riêng nhưng vẫn thuộc một nền tảng.</li><li>Không dùng các từ chung như Flow, Form, Process hay ERP làm tên chính.</li></ul></div>
<div class="card"><h3>Trạng thái thương mại: provisional</h3><p class="muted small">Chưa xác nhận được domain, GitHub organization hay khả năng đăng ký nhãn hiệu. Một số tên khá gần ý tưởng như Orqio và Orqanta đã có sản phẩm hoạt động. Giữ trạng thái provisional cho đến khi kiểm tra nhãn hiệu hoàn tất.</p></div>
</div>
<div class="table-wrap" style="margin-top:16px"><table><thead><tr><th>Tên module dự kiến</th><th>Chức năng</th></tr></thead><tbody>
<tr><td>OPVARYN Core</td><td>Nền tảng và execution engine</td></tr>
<tr><td>OPVARYN Studio</td><td>Business Object, Form &amp; Application Builder</td></tr>
<tr><td>OPVARYN Flow</td><td>Workflow Designer và Automation</td></tr>
<tr><td>OPVARYN Connect</td><td>Integration Hub</td></tr>
<tr><td>OPVARYN Insights</td><td>Analytics và Reporting</td></tr>
</tbody></table></div><p class="muted small" style="margin-top:11px">Các tên module là định hướng thương hiệu, chưa phải cam kết về thời điểm. Mapping vào roadmap: MVP V1 ≈ Core, V2 ≈ Studio.</p></section>
"""

SINGLE_FILE_REPLACEMENTS = [
    # index.html: insert the naming section before the product definition section.
    (
        "index.html",
        '<section class="section" id="definition">',
        NAMING_SECTION + '<section class="section" id="definition">',
        1,
    ),
    # decisions.html: the name is no longer an open question.
    (
        "decisions.html",
        "<li>Demo thể hiện vision; MVP giới hạn use case vận hành thật.</li>",
        "<li>Demo thể hiện vision; MVP giới hạn use case vận hành thật.</li>"
        "<li>Tên kỹ thuật của dự án: OPVARYN; thương hiệu thương mại giữ provisional, chờ kiểm tra nhãn hiệu.</li>",
        1,
    ),
    (
        "decisions.html",
        "<li>Tên sản phẩm, pilot department, 2–3 nghiệp vụ đầu tiên.</li>",
        "<li>Pilot department và 2–3 nghiệp vụ đầu tiên (tên kỹ thuật đã chốt: OPVARYN).</li>",
        1,
    ),
    # roadmap.html: Phase A item now reflects the settled name.
    (
        "roadmap.html",
        "<span>Chọn tên sản phẩm tạm và định vị một câu.</span>",
        "<span>Chốt định vị một câu (tên kỹ thuật OPVARYN đã chốt tạm; thương hiệu còn provisional).</span>",
        1,
    ),
]

APP_JS_REPLACEMENTS = [
    (
        "['Tổng quan và định vị','index.html','Platform quản lý vận hành nội bộ, phạm vi và nguyên tắc sản phẩm'],",
        "['Tổng quan và định vị','index.html','OPVARYN — nền tảng quản lý vận hành nội bộ, phạm vi và nguyên tắc sản phẩm'],",
        1,
    ),
    (
        "['Nguyên tắc không giới hạn phiếu','index.html#principles'",
        "['Tên dự án OPVARYN','index.html#naming','Operations + Variability; cấu trúc thương hiệu Core, Studio, Flow, Connect, Insights; thương hiệu provisional'],\n   ['Nguyên tắc không giới hạn phiếu','index.html#principles'",
        1,
    ),
]

README_TXT_REPLACEMENTS = [
    (
        "OPERATIONS PLAYBOOK — SỔ TAY Ý TƯỞNG OFFLINE\n",
        "OPVARYN PLAYBOOK — SỔ TAY Ý TƯỞNG OFFLINE\n\n"
        "Dự án: OPVARYN (Business Operations Platform). Tên kỹ thuật đã chốt tạm;\n"
        "thương hiệu thương mại giữ trạng thái provisional cho đến khi kiểm tra nhãn hiệu.\n",
        1,
    ),
    (
        "- index.html: tầm nhìn, nguyên tắc, use cases\n",
        "- index.html: tầm nhìn, nguyên tắc, use cases, tên dự án\n",
        1,
    ),
    (
        "- Bộ HTML này là tài liệu ghi nhớ, KHÔNG phải demo sản phẩm.\n",
        "- Bộ HTML này là tài liệu ghi nhớ, KHÔNG phải demo sản phẩm.\n"
        "- Bản demo sản phẩm nằm trong repo opvaryn (apps/, packages/), không nằm trong thư mục này.\n",
        1,
    ),
]


def apply(path: Path, old: str, new: str, expected: int) -> None:
    text = path.read_text(encoding="utf-8")
    found = text.count(old)
    if found != expected:
        raise SystemExit(f"{path.name}: expected {expected} occurrence(s), found {found} for: {old[:70]!r}")
    path.write_text(text.replace(old, new), encoding="utf-8")
    print(f"  {path.name}: {found} x {old[:48]!r}...")


def main() -> None:
    pages = [PLAYBOOK / name for name in HTML_PAGES]

    print("Shared header/sidebar/footer replacements:")
    for old, new, expected in SHARED_REPLACEMENTS:
        total = 0
        for page in pages:
            text = page.read_text(encoding="utf-8")
            total += text.count(old)
        if total != expected:
            raise SystemExit(f"expected {expected} total occurrences of {old[:60]!r}, found {total}")
        for page in pages:
            apply(page, old, new, page.read_text(encoding="utf-8").count(old))

    print("Per-file replacements:")
    for name, old, new, expected in SINGLE_FILE_REPLACEMENTS:
        apply(PLAYBOOK / name, old, new, expected)

    print("Search index (app.js):")
    for old, new, expected in APP_JS_REPLACEMENTS:
        apply(PLAYBOOK / "app.js", old, new, expected)

    print("README.txt:")
    for old, new, expected in README_TXT_REPLACEMENTS:
        apply(PLAYBOOK / "README.txt", old, new, expected)

    print("done")


if __name__ == "__main__":
    main()
