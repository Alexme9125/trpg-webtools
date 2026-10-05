"""Real-browser host character adjustments, multiplayer propagation and mobile acceptance."""
import argparse
import json
import re
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:5173')
args = parser.parse_args()
out = Path('test-results/adjustments')
out.mkdir(parents=True, exist_ok=True)
checks, errors = [], []
fixtures = json.loads(subprocess.check_output(['node', '--import', 'tsx', '--input-type=module', '-e',
    "import { preparedCharacter } from './tests/fixtures/adjustment-character.ts'; console.log(JSON.stringify({dnd:preparedCharacter('dnd'),coc:preparedCharacter('coc')}));"], text=True))

def check(name):
    checks.append(name)
    print('PASS', name, flush=True)

def close(page):
    page.get_by_role('button', name='关闭窗口', exact=True).click()
    expect(page.get_by_role('dialog')).to_have_count(0)

def choose(page, rule):
    page.goto(args.url, wait_until='domcontentloaded')
    page.locator(f'.rule-card.{rule} .rule-choose').click()

def create(page, rule):
    choose(page, rule)
    page.get_by_label('你的称呼').fill('测试主持人')
    page.get_by_label('房间名称').fill('局内修正验收 ' + rule)
    page.get_by_role('button', name='创建房间，成为主持人').click()
    expect(page.locator('.room-title h1')).to_contain_text('局内修正验收')
    return page.locator('.room-code b').inner_text()

def join(page, rule, code, name, card):
    choose(page, rule)
    page.get_by_role('button', name='加入房间', exact=True).first.click()
    page.get_by_label('你的称呼').fill(name)
    page.get_by_label('房间码', exact=True).fill(code)
    page.locator('form').get_by_role('button', name='加入房间', exact=True).click()
    page.get_by_role('button', name='创建角色', exact=True).click()
    page.get_by_label('导入角色卡文件', exact=True).set_input_files({'name':'character.json','mimeType':'application/json','buffer':json.dumps(card, ensure_ascii=False).encode()})
    expect(page.get_by_label('角色姓名')).to_have_value(card['name'])
    page.get_by_role('button', name='保存并提交审核', exact=True).click()
    expect(page.get_by_role('dialog')).to_have_count(0)

def start(host, players):
    for player in players:
        player.get_by_role('button', name='我准备好了', exact=True).click()
    host.get_by_role('button', name='我准备好了', exact=True).click()
    host.get_by_role('button', name=re.compile('^审核与制卡要求')).click()
    for button in host.locator('.review-queue > button').all():
        button.click()
        host.get_by_role('button', name='通过此卡', exact=True).click()
        expect(host.get_by_role('button', name='已通过审核', exact=True)).to_be_visible()
    close(host)
    host.get_by_role('button', name='开启故事', exact=True).click()
    expect(host.locator('.status-pill')).to_contain_text('故事进行中')

def open_adjust(page, host=True):
    page.get_by_role('button', name='角色调整' if host else '角色数值', exact=True).click()
    expect(page.locator('.character-adjustments')).to_be_visible()

def encounter(page):
    page.get_by_role('button',name='场景与回合',exact=True).click()
    page.get_by_role('button',name=re.compile('^行动与状态')).click()
    expect(page.locator('.encounter-panel')).to_be_visible()

def field(page, name):
    page.locator('.adjustment-fields').get_by_role('button', name=re.compile('^'+name+'，')).click()

def current(page, value):
    expect(page.get_by_test_id('effective-value')).to_have_text(str(value))

def lasting(page, value, reason='剧情成长'):
    page.locator('.adjustment-mode').get_by_role('button', name='长期数值', exact=True).click()
    page.get_by_label('长期数值', exact=True).fill(str(value))
    page.get_by_label('长期调整原因', exact=True).fill(reason)
    page.get_by_role('button', name='保存长期数值', exact=True).click()
    try:
        expect(page.locator('.adjustment-save-status')).to_contain_text('已保存')
    except Exception:
        page.screenshot(path=str(out/'failed-save.png'),animations='disabled')
        print(page.locator('body').inner_text(), flush=True)
        raise
    expect(page.locator('.adjustment-stale')).to_have_count(0)
    expect(page.get_by_label('长期调整原因',exact=True)).to_have_value(reason)
    expect(page.get_by_role('button',name='保存长期数值',exact=True)).to_be_disabled()

def temporary(page, amount, name):
    page.locator('.adjustment-mode').get_by_role('button', name='临时修正', exact=True).click()
    page.get_by_label('临时修正值', exact=True).fill(str(amount))
    page.get_by_label('效果名称', exact=True).fill(name)
    page.get_by_label('效果结束条件', exact=True).fill('下一次休息后')
    page.get_by_role('button', name='添加临时效果', exact=True).click()
    expect(page.locator('.temporary-effect').filter(has_text=name)).to_be_visible()
    expect(page.locator('.adjustment-stale')).to_have_count(0)

def fit(page, name):
    geometry = page.evaluate('''() => ({v:innerWidth,w:document.documentElement.scrollWidth, nodes:[...document.querySelectorAll('.modal,.modal-content,.adjustment-layout,.adjustment-editor,.temporary-effect')].map(e=>({w:e.clientWidth,s:e.scrollWidth,r:e.getBoundingClientRect().right}))})''')
    assert geometry['w'] <= geometry['v']+1 and all(n['s'] <= n['w']+1 and n['r'] <= geometry['v']+1 for n in geometry['nodes']), (name, geometry)
    check(name+' fits')

def export(page):
    with page.expect_download() as download:
        page.get_by_role('button', name='导出当前角色', exact=True).click()
    path=out/'exported-character.json'
    download.value.save_as(str(path))
    return json.loads(path.read_text())

with sync_playwright() as p:
    chrome=Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    browser=p.chromium.launch(headless=True, **({'executable_path':str(chrome)} if chrome.exists() else {}))
    contexts=[]
    def new_page():
        context=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
        contexts.append(context)
        page=context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        return page
    try:
        host, player, other = new_page(), new_page(), new_page()
        code=create(host,'dnd')
        join(player,'dnd',code,'玩家一',fixtures['dnd'])
        second={**fixtures['dnd'],'id':'second-character','name':'洛伊'}
        join(other,'dnd',code,'玩家二',second)
        open_adjust(host)
        expect(host.get_by_role('button', name='添加临时效果', exact=True)).to_have_count(0)
        close(host)
        check('Lobby adjustment view is read-only')
        start(host,[player,other])
        open_adjust(host)
        field(host,'敏捷')
        lasting(host,18)
        current(host,18)
        temporary(host,-2,'受伤迟缓')
        current(host,16)
        temporary(host,1,'短暂鼓舞')
        current(host,17)
        expect(host.locator('.temporary-effect')).to_have_count(2)
        host.get_by_role('button',name='停用短暂鼓舞',exact=True).click()
        current(host,16)
        host.get_by_role('button',name='启用短暂鼓舞',exact=True).click()
        current(host,17)
        host.get_by_role('button',name='移除短暂鼓舞',exact=True).click()
        current(host,16)
        expect(host.locator('.temporary-effect')).to_have_count(1)
        check('Consecutive effects on the same attribute stack and can be toggled or removed independently')
        host.locator('.adjustment-tabs').get_by_role('button', name=re.compile('^技能')).click()
        host.get_by_label('搜索要调整的技能').fill('隐匿')
        field(host,'隐匿')
        current(host,3)
        lasting(host,8,'潜行训练')
        current(host,7)
        check('Ability changes propagate into D&D skills; lasting values exclude temporary ability effects')

        player.get_by_role('button',name='检定',exact=True).click()
        player.get_by_label('选择技能',exact=True).select_option('stealth')
        expect(player.locator('.check-preview')).to_contain_text('D20 + 7')
        player.get_by_role('button',name='进行检定',exact=True).click()
        expect(player.locator('.roll-event').last).to_contain_text('隐匿')
        check('Player check preview and server roll use adjusted skills')
        host.get_by_role('button',name='停用受伤迟缓',exact=True).click()
        current(host,8)
        expect(player.locator('.check-preview')).to_contain_text('D20 + 8')
        host.get_by_role('button',name='启用受伤迟缓',exact=True).click()
        current(host,7)
        check('Disable and re-enable restore the correct live values on both clients')

        options=host.get_by_label('选择角色',exact=True).locator('option').all()
        second_id=next(o.get_attribute('value') for o in options if '洛伊' in o.inner_text())
        first_id=next(o.get_attribute('value') for o in options if '希尔' in o.inner_text())
        host.get_by_label('选择角色',exact=True).select_option(second_id)
        field(host,'敏捷')
        current(host,12)
        lasting(host,14)
        host.get_by_label('选择角色',exact=True).select_option(first_id)
        field(host,'敏捷')
        current(host,16)
        check('Character selection isolates changes to the chosen member')

        host.get_by_label('临时修正值',exact=True).fill('99')
        host.get_by_label('效果名称',exact=True).fill('越界测试')
        expect(host.locator('.adjustment-preview')).to_contain_text('1–30')
        expect(host.get_by_role('button',name='添加临时效果',exact=True)).to_be_disabled()
        check('Out-of-range effective values are blocked before submission')
        host.get_by_label('临时修正值',exact=True).fill('1')
        player.locator('.my-resources .resource-control').first.get_by_role('button').first.click()
        expect(host.locator('.adjustment-stale')).to_be_visible()
        expect(host.get_by_role('button',name='添加临时效果',exact=True)).to_be_disabled()
        host.get_by_role('button',name='载入最新数值',exact=True).click()
        expect(host.locator('.adjustment-stale')).to_have_count(0)
        check('Concurrent changes preserve the draft and require refreshing its basis')
        host.get_by_label('效果名称',exact=True).fill('')
        host.screenshot(path=str(out/'dnd-desktop.png'),animations='disabled')
        fit(host,'Desktop character adjustment panel')
        close(host)

        open_adjust(player,False)
        field(player,'敏捷')
        current(player,16)
        expect(player.get_by_role('button',name='添加临时效果',exact=True)).to_have_count(0)
        expect(player.get_by_role('button',name='停用受伤迟缓',exact=True)).to_have_count(0)
        close(player)
        exported=export(player)
        assert exported['attributes']['dex']==12 and exported['adjustments']['temporary'][0]['name']=='受伤迟缓'
        assert len(exported['adjustments']['permanent'])==2
        check('Player view is read-only and export preserves creation plus both adjustment layers')

        host.reload(wait_until='domcontentloaded')
        open_adjust(host)
        field(host,'敏捷')
        current(host,16)
        host.get_by_role('button',name='移除受伤迟缓',exact=True).click()
        current(host,18)
        host.get_by_role('button',name='重置长期修正',exact=True).click()
        current(host,12)
        check('Reconnect retains effects; remove and reset restore original values')
        close(host)
        host.locator('.member-list').get_by_role('button',name=re.compile('玩家一')).click()
        host.get_by_role('button',name='调整属性与技能',exact=True).click()
        expect(host.get_by_label('选择角色',exact=True)).to_have_value(first_id)
        close(host)
        check('Clicking a character provides a direct adjustment entry')

        # Two windows share the host identity. Defaults follow live character values until overridden.
        battle=host.context.new_page()
        battle.on('pageerror',lambda error: errors.append(str(error)))
        battle.goto(args.url,wait_until='domcontentloaded')
        encounter(battle)
        battle.locator('.encounter-row').filter(has_text='希尔').click()
        expect(battle.get_by_label('体质豁免总加值',exact=True)).to_have_value('3')
        open_adjust(host)
        field(host,'体质')
        lasting(host,18)
        expect(battle.get_by_label('体质豁免总加值',exact=True)).to_have_value('6')
        battle.get_by_label('体质豁免总加值',exact=True).fill('9')
        lasting(host,16)
        expect(battle.get_by_label('体质豁免总加值',exact=True)).to_have_value('9')
        battle.get_by_role('button',name='使用角色最新加值',exact=True).click()
        expect(battle.get_by_label('体质豁免总加值',exact=True)).to_have_value('5')
        close(host)
        battle.close()
        check('D&D concentration defaults follow live constitution; explicit host overrides can be reset')

        coc_host,coc_player=new_page(),new_page()
        coc_code=create(coc_host,'coc')
        join(coc_player,'coc',coc_code,'调查员',fixtures['coc'])
        start(coc_host,[coc_player])
        open_adjust(coc_host)
        coc_host.locator('.adjustment-tabs').get_by_role('button',name=re.compile('^技能')).click()
        coc_host.get_by_label('搜索要调整的技能').fill('侦查')
        field(coc_host,'侦查')
        lasting(coc_host,60,'幕间成长')
        temporary(coc_host,15,'光线充足')
        current(coc_host,75)
        coc_player.get_by_role('button',name='检定',exact=True).click()
        expect(coc_player.locator('.check-preview')).to_contain_text('75 / 37 / 15')
        coc_player.get_by_role('button',name='进行检定',exact=True).click()
        expect(coc_player.locator('.roll-event').last).to_contain_text('75')
        check('CoC checks use the adjusted target and refreshed hard/extreme thresholds')

        for width in [390,320]:
            coc_host.set_viewport_size({'width':width,'height':844})
            fit(coc_host,f'Mobile {width}px')
            coc_host.locator('.adjustment-editor').scroll_into_view_if_needed()
            coc_host.screenshot(path=str(out/f'coc-mobile-{width}.png'),animations='disabled')
        coc_host.get_by_role('button',name='清除全部',exact=True).click()
        coc_host.get_by_role('button',name='确认清除',exact=True).click()
        current(coc_host,60)
        expect(coc_player.locator('.check-preview')).to_contain_text('60 / 30 / 12')
        check('Mobile controls are reachable and clearing effects preserves lasting growth')
        close(coc_host)
        coc_host.set_viewport_size({'width':1440,'height':1000})
        coc_host.get_by_role('button',name='切换深色模式',exact=True).click()
        open_adjust(coc_host)
        coc_host.screenshot(path=str(out/'coc-dark.png'),animations='disabled')
        fit(coc_host,'Dark mode')
        close(coc_host)

        coc_battle=coc_host.context.new_page()
        coc_battle.on('pageerror',lambda error: errors.append(str(error)))
        coc_battle.goto(args.url,wait_until='domcontentloaded')
        encounter(coc_battle)
        coc_battle.get_by_label('防守者').select_option(label='林雾')
        initial_dodge=fixtures['coc']['skills']['dodge']
        expect(coc_battle.get_by_label('防守技能百分比',exact=True)).to_have_value(str(initial_dodge))
        open_adjust(coc_host)
        coc_host.locator('.adjustment-tabs').get_by_role('button',name=re.compile('^技能')).click()
        coc_host.get_by_label('搜索要调整的技能').fill('闪避')
        field(coc_host,'闪避')
        lasting(coc_host,45)
        expect(coc_battle.get_by_label('防守技能百分比',exact=True)).to_have_value('45')
        coc_battle.get_by_label('防守技能百分比',exact=True).fill('70')
        temporary(coc_host,-5,'腿部受伤')
        expect(coc_battle.get_by_label('防守技能百分比',exact=True)).to_have_value('70')
        coc_battle.get_by_role('button',name='使用角色当前防守技能',exact=True).click()
        expect(coc_battle.get_by_label('防守技能百分比',exact=True)).to_have_value('40')
        close(coc_host)
        coc_battle.close()
        check('CoC opposed-roll defaults follow adjusted dodge and preserve explicit overrides')

        # Re-import an exported adjusted card in another lobby, then inspect its review.
        imported_host,imported_player=new_page(),new_page()
        imported_code=create(imported_host,'dnd')
        join(imported_player,'dnd',imported_code,'导入玩家',exported)
        imported_host.get_by_role('button',name=re.compile('^审核与制卡要求')).click()
        expect(imported_host.locator('.adjustment-summary')).to_contain_text('受伤迟缓')
        expect(imported_host.locator('.adjustment-summary')).to_contain_text('潜行训练')
        expect(imported_host.get_by_role('button',name='通过此卡',exact=True)).to_be_enabled()
        check('Re-imported adjustments are visible to the host before card approval')
        assert not errors, errors
        check('No uncaught browser errors')
    finally:
        (out/'report.json').write_text(json.dumps({'checks':checks,'errors':errors},ensure_ascii=False,indent=2))
        for context in contexts: context.close()
        browser.close()
print(f'{len(checks)} browser checks passed',flush=True)
