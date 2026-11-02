"""Write web/icons/: icon.svg plus the PNG sizes the manifest and iOS need, rendered with Playwright.

    py -3.14 scripts/make_icons.py      (needs: pip install playwright, and Edge or Chrome)
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "web", "icons")
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "tests", "browser"))

from serve_util import launch_browser  # noqa: E402

ART = ('<text x="256" y="292" text-anchor="middle" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" '
       'font-weight="800" font-size="232" fill="#4fc3f7">dB</text>'
       '<path d="M112 352 H200 V384 H288 V416 H400" fill="none" stroke="#ffd54f" stroke-width="24" '
       'stroke-linecap="round" stroke-linejoin="round"/>')


def svg(rounded=True, scale=1.0):
    bg = '<rect width="512" height="512" rx="{}" fill="#000000"/>'.format(112 if rounded else 0)
    art = ART if scale == 1 else '<g transform="translate(256 256) scale({}) translate(-256 -256)">{}</g>'.format(
        scale, ART)
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">{}{}</svg>'.format(bg, art)


def main():
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "icon.svg"), "w", encoding="utf-8") as f:
        f.write(svg() + "\n")
    targets = [("icon-192.png", 192, svg()), ("icon-512.png", 512, svg()),
               ("icon-maskable-512.png", 512, svg(rounded=False, scale=0.76)),   # art inside the 80 % safe zone
               ("apple-touch-icon.png", 180, svg(rounded=False, scale=0.9))]     # iOS adds its own corners
    with launch_browser() as browser:
        page = browser.new_page()
        for name, size, markup in targets:
            page.set_viewport_size({"width": size, "height": size})
            page.set_content('<html><body style="margin:0;background:transparent">'
                             '<div style="width:{0}px;height:{0}px">{1}</div></body></html>'.format(
                                 size, markup.replace("<svg ", '<svg width="{0}" height="{0}" '.format(size))))
            page.locator("svg").screenshot(path=os.path.join(OUT, name), omit_background=True)
            print("wrote", name)


if __name__ == "__main__":
    main()
