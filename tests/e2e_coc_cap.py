"""CoC attribute caps: real rolls, saved drafts, room restrictions and responsive UI."""
import argparse
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:3001')
args = parser.parse_args()
out = Path('test-results/coc-cap')
out.mkdir(parents=True, exist_ok=True)
checks, errors = [], []
names = ['力量', '体质', '体型', '敏捷', '外貌', '智力', '意志', '教育']

def check(message):
    checks.append(message)
    print('PASS', message, flush=True)

def close(page):
    page.get_by_role('button', name='关闭窗口', exact=True).click()
    expect(page.get_by_role('dialog')).to_have_count(0)

def attributes(page):
    page.get_by_role('button', name='属性与状态', exact=True).click()

def values(page):
    return [int(page.get_by_label(name+'属性', exact=True).input_value()) for name in names]

def total(page):
    result = sum(values(page))
    expect(page.get_by_label('八项属性总和', exact=True)).to_have_text(str(result))
    return result

def cap(page, value):
    page.get_by_label('启用属性点上限', exact=True).check()
    page.get_by_label('总和上限', exact=True).fill(str(value))

def roll(page):
    page.get_by_role('button', name='重掷全部', exact=True).click()

def archive(page):
    page.locator('.sidebar').get_by_role('button', name='角色档案', exact=True).click()

def new_card(page, rule='coc'):
    page.get_by_role('button', name='新建角色', exact=True).click()
    page.locator('.new-character-option.'+rule).click()
    expect(page.locator('.character-editor')).to_be_visible()

def fit(page, message):
    geometry = page.evaluate('''() => ({viewport:innerWidth, document:document.documentElement.scrollWidth, boxes:[...document.querySelectorAll('.modal,.coc-attribute-cap,.coc-cap-controls')].map(e=>({w:e.clientWidth,s:e.scrollWidth,l:e.getBoundingClientRect().left,r:e.getBoundingClientRect().right}))})''')
    assert geometry['document'] <= geometry['viewport']+1, geometry
    assert all(b['s'] <= b['w']+1 and b['l'] >= 0 and b['r'] <= geometry['viewport']+1 for b in geometry['boxes']), geometry
    check(message)

def choose(page):
    page.goto(args.url, wait_until='domcontentloaded')
    page.locator('.rule-card.coc .rule-choose').click()

def review(page):
    page.get_by_role('button', name=re.compile('^审核与制卡要求')).click()

def policy(page):
    review(page)
    page.get_by_role('button', name='剧本限制', exact=True).click()

def add_range(page, index, field, low, high):
    page.get_by_role('button', name='新增范围', exact=True).click()
    page.get_by_label(f'限制项目 {index}', exact=True).select_option(field)
    page.get_by_label(f'下限 {index}', exact=True).fill(str(low))
    page.get_by_label(f'上限 {index}', exact=True).fill(str(high))

def save_policy(page):
    version = int(re.search(r'第 (\d+) 版', page.locator('.modal-header p').inner_text()).group(1))
    page.get_by_role('button', name='保存限制并重新审核', exact=True).click()
    expect(page.locator('.modal-header p')).to_contain_text(f'第 {version + 1} 版')
    close(page)

with sync_playwright() as p:
    chrome = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    browser = p.chromium.launch(headless=True, **({'executable_path':str(chrome)} if chrome.exists() else {}))
    contexts = []
    def new_page():
        context = browser.new_context(viewport={'width':1440, 'height':1000}, accept_downloads=True)
        contexts.append(context)
        page = context.new_page()
        page.set_default_timeout(10000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        return page
    page = new_page()
    try:
        page.goto(args.url, wait_until='domcontentloaded')
        archive(page)
        new_card(page)
        attributes(page)
        expect(page.get_by_label('启用属性点上限', exact=True)).not_to_be_checked()
        expect(page.get_by_label('总和上限', exact=True)).to_be_disabled()
        before = values(page)
        cap(page, 195)
        assert values(page) == before
        roll(page)
        assert total(page) == 195
        assert 15 <= int(page.get_by_label('幸运属性', exact=True).input_value()) <= 90
        check('Cap toggle preserves the draft; the minimum cap rolls directly and excludes Luck')

        cap(page, 500)
        for _ in range(30):
            roll(page)
            assert total(page) <= 500
            assert all(value % 5 == 0 for value in values(page))
        cap(page, 503)
        roll(page)
        assert total(page) <= 500
        check('Thirty repeated browser rolls and an off-grid cap never exceed the limit')

        before = values(page)
        cap(page, 194)
        expect(page.get_by_role('button', name='重掷全部', exact=True)).to_be_disabled()
        expect(page.locator('.coc-cap-error')).to_contain_text('195–720')
        assert values(page) == before
        cap(page, 450)
        roll(page)
        page.screenshot(path=str(out/'desktop-light.png'), animations='disabled')
        fit(page, 'Desktop controls fit')
        check('Impossible personal caps disable rolling and retain current values')

        saved = values(page)
        page.get_by_role('button', name='角色资料', exact=True).click()
        page.get_by_label('角色姓名').fill('上限验收调查员')
        page.get_by_label('调查员职业').select_option('教授')
        page.get_by_role('button', name='技能与熟练', exact=True).click()
        page.get_by_role('button', name='建议分配', exact=True).click()
        page.get_by_role('button', name='保存角色卡', exact=True).click()
        expect(page.get_by_role('dialog')).to_have_count(0)
        page.reload(wait_until='domcontentloaded')
        archive(page)
        page.get_by_role('button', name='打开角色卡', exact=True).click()
        attributes(page)
        expect(page.get_by_label('启用属性点上限', exact=True)).to_be_checked()
        expect(page.get_by_label('总和上限', exact=True)).to_have_value('450')
        assert values(page) == saved
        with page.expect_download() as download:
            page.get_by_role('button', name='JSON', exact=True).click()
        exported = out/'saved-character.json'
        download.value.save_as(str(exported))
        cap(page, 195)
        page.get_by_label('导入角色卡文件', exact=True).set_input_files(str(exported))
        attributes(page)
        assert values(page) == saved
        expect(page.get_by_label('总和上限', exact=True)).to_have_value('195')
        check('Saved card and preference survive reload; imports retain their original values')
        close(page)
        new_card(page)
        attributes(page)
        assert total(page) == 195
        check('Persisted cap also applies to a new card’s initial generation')
        close(page)
        page.get_by_role('button', name='切换深色模式', exact=True).click()
        new_card(page)
        attributes(page)
        cap(page, 450)
        roll(page)
        page.screenshot(path=str(out/'desktop-dark.png'), animations='disabled')
        for width in [390, 320]:
            page.set_viewport_size({'width':width, 'height':900})
            page.locator('.coc-attribute-cap').scroll_into_view_if_needed()
            page.get_by_label('总和上限', exact=True).fill('400')
            roll(page)
            assert total(page) <= 400
            page.locator('.coc-attribute-cap').scroll_into_view_if_needed()
            fit(page, f'{width}px dark controls fit and remain usable')
            page.screenshot(path=str(out/f'mobile-{width}-dark.png'), animations='disabled')
        page.get_by_label('总和上限', exact=True).fill('')
        page.get_by_label('启用属性点上限', exact=True).uncheck()
        roll(page)
        page.set_viewport_size({'width':1440, 'height':1000})
        close(page)
        new_card(page)
        attributes(page)
        expect(page.get_by_label('启用属性点上限', exact=True)).not_to_be_checked()
        check('Turning the cap off persists even after clearing the input')
        close(page)
        page.get_by_role('button', name='切换浅色模式', exact=True).click()
        new_card(page)
        attributes(page)
        cap(page, 500)
        page.set_viewport_size({'width':320, 'height':900})
        page.locator('.coc-attribute-cap').scroll_into_view_if_needed()
        fit(page, '320px light controls fit')
        page.screenshot(path=str(out/'mobile-320-light.png'), animations='disabled')
        page.set_viewport_size({'width':1440, 'height':1000})
        close(page)
        new_card(page, 'dnd')
        attributes(page)
        expect(page.locator('.coc-attribute-cap')).to_have_count(0)
        roll(page)
        check('D&D retains its normal attribute workflow')
        close(page)

        host, player = new_page(), new_page()
        choose(host)
        host.get_by_label('你的称呼').fill('骰点主持人')
        host.get_by_label('房间名称').fill('属性上限验收')
        host.get_by_role('button', name='创建房间，成为主持人').click()
        expect(host.locator('.room-title h1')).to_have_text('属性上限验收')
        code = host.locator('.room-code b').inner_text()
        policy(host)
        add_range(host, 1, 'attributeTotal', 400, 450)
        add_range(host, 2, 'attributes.str', 50, 60)
        save_policy(host)
        player.goto(args.url, wait_until='domcontentloaded')
        archive(player)
        new_card(player)
        attributes(player)
        cap(player, 195)
        close(player)
        choose(player)
        player.get_by_role('button', name='加入房间', exact=True).first.click()
        player.get_by_label('你的称呼').fill('调查员')
        player.get_by_label('房间码', exact=True).fill(code)
        player.locator('form').get_by_role('button', name='加入房间', exact=True).click()
        player.get_by_role('button', name='创建角色', exact=True).click()
        attributes(player)
        assert 400 <= total(player) <= 450
        assert 50 <= int(player.get_by_label('力量属性', exact=True).input_value()) <= 60
        expect(player.get_by_label('启用属性点上限', exact=True)).to_be_checked()
        expect(player.get_by_label('启用属性点上限', exact=True)).to_be_disabled()
        expect(player.get_by_label('总和上限', exact=True)).to_have_value('450')
        expect(player.get_by_label('总和上限', exact=True)).not_to_be_editable()
        for _ in range(10):
            roll(player)
            assert 400 <= total(player) <= 450
            assert 50 <= int(player.get_by_label('力量属性', exact=True).input_value()) <= 60
        check('Room cap is locked at the host value; the saved personal cap of 195 is ignored')

        oversized = json.loads(exported.read_text())
        oversized['name'] = '受限调查员'
        oversized['attributes'] = {key:90 for key in oversized['attributes']}
        oversized['attributes']['luck'] = 77
        def import_oversized():
            player.get_by_label('导入角色卡文件', exact=True).set_input_files({'name':'oversized.json', 'mimeType':'application/json', 'buffer':json.dumps(oversized, ensure_ascii=False).encode()})
            attributes(player)
            assert total(player) == 720
        import_oversized()
        player.get_by_role('button', name='保存并提交审核', exact=True).click()
        expect(player.get_by_role('dialog')).to_have_count(0)
        expect(player.get_by_role('button', name='我准备好了', exact=True)).to_be_disabled()
        review(host)
        expect(host.get_by_role('button', name='通过此卡', exact=True)).to_be_disabled()
        expect(host.locator('.validation-summary')).to_contain_text('当前 720')
        close(host)
        check('An imported over-cap draft cannot ready or pass host review')
        player.get_by_role('button', name='编辑角色卡', exact=True).click()
        attributes(player)
        assert total(player) == 720
        expect(player.locator('.coc-cap-resolution')).to_contain_text('总和将为 440')
        player.screenshot(path=str(out/'room-limits.png'), animations='disabled')
        close(player)
        player.get_by_role('button', name='切换深色模式', exact=True).click()
        player.get_by_role('button', name='编辑角色卡', exact=True).click()
        attributes(player)
        for width in [390, 320]:
            player.set_viewport_size({'width':width, 'height':900})
            player.locator('.coc-cap-resolution').scroll_into_view_if_needed()
            fit(player, f'{width}px locked room cap and correction actions fit')
            player.screenshot(path=str(out/f'room-reduction-{width}-dark.png'), animations='disabled')
        player.get_by_role('button', name='按比例降低', exact=True).click()
        assert values(player) == [55] * 8
        assert total(player) == 440
        expect(player.get_by_label('幸运属性', exact=True)).to_have_value('77')
        expect(player.locator('.coc-cap-notice')).to_contain_text('720 → 440')
        expect(player.locator('.coc-cap-notice')).to_contain_text('复核职业点和兴趣点')
        player.set_viewport_size({'width':1440, 'height':1000})
        player.screenshot(path=str(out/'room-reduced.png'), animations='disabled')
        player.get_by_role('button', name='技能与熟练', exact=True).click()
        player.get_by_role('button', name='建议分配', exact=True).click()
        player.get_by_role('button', name='保存并提交审核', exact=True).click()
        expect(player.get_by_role('dialog')).to_have_count(0)
        player.reload(wait_until='domcontentloaded')
        player.get_by_role('button', name='编辑角色卡', exact=True).click()
        attributes(player)
        assert values(player) == [55] * 8
        expect(player.get_by_label('幸运属性', exact=True)).to_have_value('77')
        check('Proportional reduction floors to fives, preserves Luck and survives save/reconnect')

        import_oversized()
        policy(host)
        host.get_by_label('下限 2', exact=True).fill('60')
        host.get_by_label('上限 2', exact=True).fill('70')
        save_policy(host)
        expect(player.get_by_role('button', name='按比例降低', exact=True)).to_be_disabled()
        expect(player.locator('.coc-cap-resolution')).to_contain_text('力量将为 55，须在 60–70 内')
        assert values(player) == [90] * 8
        player.screenshot(path=str(out/'room-reduction-conflict.png'), animations='disabled')
        player.get_by_role('button', name='重新掷骰', exact=True).click()
        assert 400 <= total(player) <= 450
        assert 60 <= int(player.get_by_label('力量属性', exact=True).input_value()) <= 70
        check('Live host changes invalidate an unsafe reduction; reroll resolves it without partial changes')
        player.get_by_role('button', name='技能与熟练', exact=True).click()
        player.get_by_role('button', name='建议分配', exact=True).click()
        player.get_by_role('button', name='保存并提交审核', exact=True).click()
        expect(player.get_by_role('dialog')).to_have_count(0)
        player.get_by_role('button', name='我准备好了', exact=True).click()
        host.get_by_role('button', name='我准备好了', exact=True).click()
        expect(host.get_by_role('button', name='开启故事', exact=True)).to_be_disabled()
        review(host)
        host.get_by_role('button', name='通过此卡', exact=True).click()
        expect(host.get_by_role('button', name='已通过审核', exact=True)).to_be_visible()
        close(host)
        host.get_by_role('button', name='开启故事', exact=True).click()
        expect(host.locator('.status-pill')).to_contain_text('故事进行中')
        check('A capped, allocated card still needs host approval before the room can start')
        archive(player)
        new_card(player)
        attributes(player)
        expect(player.get_by_label('总和上限', exact=True)).to_have_value('195')
        expect(player.get_by_label('总和上限', exact=True)).to_be_editable()
        assert total(player) == 195
        check('The host cap does not overwrite the personal archive preference')
        close(player)
        assert not errors, errors
        check('No uncaught browser errors')
    except Exception:
        for index, context in enumerate(contexts):
            for index2, failed in enumerate(context.pages):
                failed.screenshot(path=str(out/f'failure-{index}-{index2}.png'), animations='disabled')
        raise
    finally:
        (out/'report.json').write_text(json.dumps({'checks':checks, 'pageErrors':errors}, ensure_ascii=False, indent=2))
        browser.close()
