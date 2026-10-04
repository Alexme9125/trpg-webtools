"""Keeper library, allocation, host review and scenario policy browser acceptance."""
import argparse
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:5173')
args = parser.parse_args()
out = Path('test-results/review')
out.mkdir(parents=True, exist_ok=True)
checks, errors = [], []

def check(message):
    checks.append(message)
    print('PASS', message, flush=True)

def choose(page):
    page.goto(args.url, wait_until='domcontentloaded')
    page.locator('.rule-card.coc .rule-choose').click()

def close(page):
    page.get_by_role('button', name='关闭窗口', exact=True).click()
    if page.locator('.host-toolkit').count():
        page.locator('.app-header').get_by_role('button', name='返回房间', exact=True).click()

def review(page):
    if not page.locator('.host-tool-links').is_visible():
        page.get_by_role('button', name='局内工具', exact=True).click()
    page.get_by_role('button', name=re.compile('审核与制卡要求')).click()

def keeper(page):
    if page.locator('.sidebar').is_visible():
        page.locator('.sidebar').get_by_role('button', name='主持人工具集', exact=True).click()
    else:
        page.get_by_role('button', name='打开导航', exact=True).click()
        page.locator('.mobile-navigation').get_by_role('button', name='主持人工具集', exact=True).click()
    page.get_by_role('button', name=re.compile('房间 NPC 与怪物卡库')).click()

def shot(page, name):
    page.wait_for_function("[...document.querySelectorAll('.page-enter')].filter(e=>e.getClientRects().length).every(e=>Number(getComputedStyle(e).opacity) >= 0.99)")
    page.screenshot(path=str(out/name), full_page=False, animations='disabled')

def fit(page, name):
    result = page.evaluate('''() => ({viewport:innerWidth, height:innerHeight, document:document.documentElement.scrollWidth, dialogs:[...document.querySelectorAll('.modal')].map(e=>({width:e.clientWidth,scroll:e.scrollWidth,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom}))})''')
    assert result['document'] <= result['viewport'] + 1, (name, result)
    assert all(d['scroll'] <= d['width'] + 1 and d['left'] >= 0 and d['right'] <= result['viewport']+1 and d['top'] >= 0 and d['bottom'] <= result['height']+1 for d in result['dialogs']), (name, result)
    check(name + ' fits without horizontal overflow')

with sync_playwright() as p:
    chrome = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    browser = p.chromium.launch(headless=True, **({'executable_path':str(chrome)} if chrome.exists() else {}))
    try:
        hp = browser.new_context(viewport={'width':1440,'height':1000}, accept_downloads=True)
        pp = browser.new_context(viewport={'width':1440,'height':1000}, accept_downloads=True)
        host, player = hp.new_page(), pp.new_page()
        host_sockets = []
        host.on('websocket', lambda ws: host_sockets.append(ws))
        for page in [host,player]:
            page.set_default_timeout(10000)
            page.on('pageerror',lambda error: errors.append(str(error)))
        choose(host)
        host.get_by_label('你的称呼').fill('阿夏 · KP')
        host.get_by_label('房间名称').fill('档案室夜谈')
        host.get_by_role('button',name='创建房间，成为主持人').click()
        expect(host.locator('.room-title h1')).to_have_text('档案室夜谈')
        code=host.locator('.room-code b').inner_text()
        expect(host.get_by_role('button',name='创建角色',exact=True)).to_have_count(0)
        choose(player)
        player.get_by_role('button',name='加入房间',exact=True).first.click()
        player.get_by_label('你的称呼').fill('林间')
        player.get_by_label('房间码',exact=True).fill(code)
        player.locator('form').get_by_role('button',name='加入房间',exact=True).click()
        expect(player.locator('.room-title h1')).to_have_text('档案室夜谈')
        check('Host has a workspace instead of a player character')

        keeper(host)
        host.get_by_role('button',name='浏览模板',exact=True).click()
        host.get_by_label('资料模板',exact=True).select_option('npc-bystander')
        host.get_by_label('生成方式',exact=True).select_option('roll')
        host.get_by_label('名称前缀',exact=True).fill('码头守卫')
        host.get_by_label('生成数量',exact=True).fill('4')
        host.get_by_role('button',name='批量生成并保存',exact=True).click()
        expect(host.locator('.keeper-card-list > button')).to_have_count(4)
        expect(host.get_by_label('资料卡名称')).to_have_value(re.compile('码头守卫'))
        check('Create four independent NPC cards from rolled template')
        host.get_by_role('button',name='新建怪物',exact=True).click()
        host.get_by_label('资料卡名称').fill('潮汐之眼')
        assert host_sockets, 'Socket.IO did not establish the WebSocket transport'
        with host_sockets[-1].expect_event('framereceived', predicate=lambda payload: 'room:state' in str(payload) and '"type":"roll"' in str(payload)):
            player.get_by_role('button',name='掷 D20',exact=True).click()
        expect(host.get_by_label('资料卡名称')).to_be_focused()
        expect(host.get_by_label('资料卡名称')).to_have_value('潮汐之眼')
        check('Other members rolling keeps the active editor focused and preserves the draft')
        host.get_by_label('私密笔记',exact=True).fill('只有KP知道：灯塔下的眼睛是线索，不是最终敌人。')
        host.get_by_label('标签（顿号分隔）').fill('海岸、最终线索')
        expect(host.get_by_label('标签（顿号分隔）')).to_have_value('海岸、最终线索')
        host.get_by_role('button',name='属性与骰式',exact=True).click()
        for name,value in [('力量',180),('体质',100),('体型',240),('敏捷',65),('意志',120)]:
            host.get_by_label('资料卡'+name,exact=True).fill(str(value))
        host.get_by_label('力量骰式',exact=True).fill('6d6*5')
        host.get_by_role('button',name='根据属性重算 HP / MP / 伤害加值 / 体格').click()
        expect(host.get_by_label('资料卡HP 上限',exact=True)).to_have_value('34')
        expect(host.get_by_label('资料卡MP 上限',exact=True)).to_have_value('24')
        host.get_by_label('资料卡当前 HP',exact=True).fill('34')
        host.get_by_label('资料卡当前 MP',exact=True).fill('24')
        expect(host.get_by_label('资料卡外貌',exact=True)).to_have_value('')
        host.get_by_role('button',name='行动与能力',exact=True).click()
        host.get_by_label('理智损失',exact=True).fill('0/1d8')
        host.get_by_role('button',name='添加攻击',exact=True).click()
        host.get_by_label('攻击名称',exact=True).fill('潮汐回响')
        host.get_by_label('伤害',exact=True).fill('1d6 + DB')
        host.get_by_role('button',name='添加技能',exact=True).click()
        host.get_by_label('NPC技能名称 1',exact=True).fill('感知潮声')
        host.get_by_label('NPC技能数值 1',exact=True).fill('110')
        host.get_by_role('button',name='保存资料卡',exact=True).click()
        expect(host.locator('.keeper-card-list > button')).to_have_count(5)
        with host.expect_download() as download:
            host.get_by_role('button',name='JSON',exact=True).click()
        card_file=out/'monster.json'
        download.value.save_as(str(card_file))
        monster=json.loads(card_file.read_text())
        assert monster['attributes']['str']==180 and monster['attributes']['app'] is None
        assert monster['maxHp']==34 and monster['skills'][0]['value']==110
        assert '只有KP知道' in monster['notes'] and monster['documentType']=='keeper-card'
        check('Monster supports >100 stats, null values, attacks, SAN loss and private notes')
        host.get_by_role('button',name='复制此资料卡',exact=True).click()
        host.get_by_role('button',name='保存资料卡',exact=True).click()
        expect(host.locator('.keeper-card-list > button')).to_have_count(6)
        with host.expect_download() as download:
            host.get_by_role('button',name='Markdown',exact=True).click()
        md_file=out/'monster-copy.md'
        download.value.save_as(str(md_file))
        host.get_by_label('导入KP资料文件').set_input_files(str(md_file.resolve()))
        expect(host.locator('.keeper-card-list > button')).to_have_count(7)
        with host.expect_download() as download:
            host.get_by_role('button',name='导出全部',exact=True).click()
        library_file=out/'keeper-collection.json'
        download.value.save_as(str(library_file))
        collection=json.loads(library_file.read_text())
        assert len(collection['cards'])==7 and len({c['id'] for c in collection['cards']})==7
        host.get_by_role('button',name='属性与骰式',exact=True).click()
        shot(host,'01-keeper-desktop-light.png')
        close(host)
        host.reload(wait_until='domcontentloaded')
        expect(host.locator('.room-title h1')).to_have_text('档案室夜谈')
        keeper(host)
        expect(host.locator('.keeper-card-list > button')).to_have_count(7)
        close(host)
        expect(player.get_by_role('button',name=re.compile('怪物卡库'))).to_have_count(0)
        assert '只有KP知道' not in player.locator('body').inner_text()
        check('KP cards copy, Markdown roundtrip, collection export and reconnect; absent from player UI')

        host.get_by_role('button',name='检定',exact=True).click()
        host.get_by_label('目标百分比',exact=False).fill('180')
        expect(host.locator('.check-preview')).to_contain_text('180 / 90 / 36')
        host.get_by_role('button',name='进行检定',exact=True).click()
        expect(host.locator('.roll-event').last).to_contain_text('180')
        check('KP can check monster values above 100 with untruncated thresholds')

        player.get_by_role('button',name='创建角色',exact=True).click()
        d=player.get_by_role('dialog')
        d.get_by_label('角色姓名').fill('艾琳 · 洛温')
        d.locator('select').first.select_option('记者')
        d.get_by_role('button',name='属性与状态',exact=True).click()
        for name in ['力量','体质','体型','敏捷','外貌','智力','意志','教育','幸运']:
            d.get_by_label(name+'属性',exact=True).fill('60')
        d.get_by_role('button',name='技能与熟练',exact=True).click()
        d.get_by_label('信用评级职业点',exact=True).fill('5')
        d.get_by_label('信用评级兴趣点',exact=True).fill('4')
        for name in ['聆听','侦查','攀爬']:
            d.get_by_label(name+'兴趣点',exact=True).fill('60')
        expect(d.locator('.point-budget.over-budget')).to_contain_text('-64')
        d.get_by_role('button',name='保存并提交审核',exact=True).click()
        expect(player.get_by_role('button',name='我准备好了')).to_be_disabled()
        review(host)
        expect(host.get_by_role('button',name='通过此卡',exact=True)).to_be_disabled()
        expect(host.locator('.validation-summary')).to_contain_text('兴趣点超支')
        host.get_by_label('审核意见',exact=True).fill('请减少兴趣点分配，保留调查记者的能力重点。')
        host.get_by_role('button',name='要求修改',exact=True).click()
        close(host)
        expect(player.locator('.my-review-status')).to_contain_text('需要修改')
        expect(player.locator('.my-review-status')).to_contain_text('请减少兴趣点分配')
        check('Overspent draft is saved but cannot ready or pass review; rejection reaches player')
        player.get_by_role('button',name='编辑角色卡',exact=True).click()
        d=player.get_by_role('dialog')
        d.get_by_role('button',name='技能与熟练',exact=True).click()
        d.get_by_label('聆听兴趣点',exact=True).fill('0')
        d.get_by_label('攀爬兴趣点',exact=True).fill('0')
        d.get_by_label('侦查兴趣点',exact=True).fill('40')
        expect(d.locator('.validation-summary')).to_contain_text('数值检查通过')
        shot(player,'02-coc-allocation-desktop.png')
        with player.expect_download() as download:
            d.get_by_role('button',name='JSON',exact=True).click()
        player_file=out/'investigator.json'
        download.value.save_as(str(player_file))
        d.get_by_role('button',name='保存并提交审核',exact=True).click()
        expect(player.locator('.my-review-status')).to_contain_text('等待审核')
        player.get_by_role('button',name='我准备好了',exact=True).click()
        host.get_by_role('button',name='我准备好了',exact=True).click()
        expect(host.get_by_role('button',name='开启故事',exact=True)).to_be_disabled()
        check('Valid allocation still requires explicit host approval')

        review(host)
        host.get_by_role('button',name='剧本限制',exact=True).click()
        host.get_by_role('button',name='新增范围',exact=True).click()
        host.get_by_label('限制项目 1',exact=True).select_option('skills.spotHidden')
        host.get_by_label('下限 1',exact=True).fill('20')
        host.get_by_label('上限 1',exact=True).fill('60')
        host.get_by_label('允许的职业',exact=True).press_sequentially('记者、医生')
        expect(host.get_by_label('允许的职业',exact=True)).to_have_value('记者、医生')
        host.get_by_label('剧本制卡说明',exact=True).fill('1920年代海岸调查。所有武器与神秘经历都需解释来源。')
        host.get_by_role('button',name='保存限制并重新审核',exact=True).click()
        expect(host.locator('.modal-header p')).to_contain_text('第 2 版')
        host.get_by_role('dialog').get_by_role('button',name=re.compile('角色卡审核')).click()
        expect(host.get_by_role('button',name='通过此卡',exact=True)).to_be_disabled()
        expect(host.locator('.validation-summary')).to_contain_text('侦查须在 20–60')
        close(host)
        expect(player.get_by_role('button',name='我准备好了',exact=True)).to_be_disabled()
        player.get_by_role('button',name='查看本桌制卡要求',exact=True).click()
        expect(player.get_by_label('上限 1',exact=True)).to_be_disabled()
        expect(player.get_by_label('上限 1',exact=True)).to_have_value('60')
        close(player)
        check('Scenario skill range invalidates readiness; players see enforced read-only policy')
        review(host)
        host.get_by_role('button',name='剧本限制',exact=True).click()
        host.get_by_label('上限 1',exact=True).fill('70')
        host.get_by_role('button',name='保存限制并重新审核',exact=True).click()
        expect(host.locator('.modal-header p')).to_contain_text('第 3 版')
        shot(host,'03-policy-desktop.png')
        host.get_by_role('dialog').get_by_role('button',name=re.compile('角色卡审核')).click()
        host.get_by_label('审核意见',exact=True).fill('背景与数值符合本剧本，通过。')
        host.get_by_role('button',name='通过此卡',exact=True).click()
        expect(host.get_by_role('button',name='已通过审核',exact=True)).to_be_disabled()
        host.locator('.modal-content').evaluate('(e)=>e.scrollTop=0')
        shot(host,'04-review-desktop.png')
        close(host)
        expect(player.locator('.my-review-status')).to_contain_text('审核通过')
        player.get_by_role('button',name='我准备好了',exact=True).click()
        host.get_by_role('button',name='我准备好了',exact=True).click()
        expect(host.get_by_role('button',name='开启故事',exact=True)).to_be_enabled()
        # Saving even a story-only edit must invalidate the approved version.
        player.get_by_role('button',name='编辑角色卡',exact=True).click()
        player.get_by_role('button',name='故事与行囊',exact=True).click()
        player.get_by_label('人物经历',exact=True).fill('曾在灯塔下发现一页失落的档案。')
        player.get_by_role('button',name='保存并提交审核',exact=True).click()
        expect(player.locator('.my-review-status')).to_contain_text('等待审核')
        expect(host.get_by_role('button',name='开启故事',exact=True)).to_be_disabled()
        check('Approved card edits invalidate approval and block start')

        # Legacy imports preserve data, but cannot silently acquire point provenance.
        legacy=json.loads(player_file.read_text()); del legacy['creation']
        legacy_file=out/'legacy-investigator.json'; legacy_file.write_text(json.dumps(legacy,ensure_ascii=False))
        player.get_by_role('button',name='编辑角色卡',exact=True).click()
        player.get_by_label('导入角色卡文件').set_input_files(str(legacy_file.resolve()))
        player.get_by_role('button',name='技能与熟练',exact=True).click()
        expect(player.get_by_text('这张旧卡没有记录技能来源',exact=True)).to_be_visible()
        player.get_by_role('button',name='保存并提交审核',exact=True).click()
        expect(player.get_by_role('button',name='我准备好了',exact=True)).to_be_disabled()
        player.get_by_role('button',name='编辑角色卡',exact=True).click()
        player.get_by_role('button',name='技能与熟练',exact=True).click()
        player.get_by_role('button',name='开始重新分配',exact=True).click()
        player.get_by_label('信用评级职业点',exact=True).fill('9')
        player.get_by_label('侦查兴趣点',exact=True).fill('40')
        player.get_by_role('button',name='保存并提交审核',exact=True).click()
        review(host)
        host.get_by_role('button',name='通过此卡',exact=True).click()
        close(host)
        player.get_by_role('button',name='我准备好了',exact=True).click()
        host.get_by_role('button',name='开启故事',exact=True).click()
        expect(player.locator('.status-pill')).to_contain_text('故事进行中')
        check('Legacy card requires reallocation; only current approval plus ready permits start')

        host.get_by_role('button',name='返回准备',exact=True).click()
        host.get_by_role('button',name='切换深色模式',exact=True).click()
        for width in [390,320]:
            host.set_viewport_size({'width':width,'height':844})
            host.get_by_role('button',name='局内工具',exact=True).click()
            keeper(host)
            host.locator('.keeper-card-list > button').filter(has_text='潮汐之眼').first.click()
            host.get_by_role('button',name='属性与骰式',exact=True).click()
            fit(host,f'Keeper editor {width}')
            shot(host,f'05-keeper-mobile-{width}.png')
            close(host)
            review(host)
            host.get_by_role('button',name='剧本限制',exact=True).click()
            fit(host,f'Scenario policy {width}')
            shot(host,f'06-policy-mobile-{width}.png')
            host.get_by_role('dialog').get_by_role('button',name=re.compile('角色卡审核')).click()
            fit(host,f'Review desk {width}')
            close(host)
            player.set_viewport_size({'width':width,'height':844})
            player.get_by_role('button',name='同桌伙伴',exact=True).click()
            player.get_by_role('button',name='编辑角色卡',exact=True).click()
            player.get_by_role('button',name='技能与熟练',exact=True).click()
            fit(player,f'CoC allocation ledger {width}')
            shot(player,f'07-allocation-mobile-{width}.png')
            close(player)
        host.set_viewport_size({'width':1440,'height':1000})
        keeper(host)
        host.locator('.keeper-card-list > button').filter(has_text='潮汐之眼').first.click()
        host.get_by_role('button',name='行动与能力',exact=True).click()
        shot(host,'08-keeper-desktop-dark.png')
        assert not errors, errors
        check('No browser runtime errors in keeper, allocation and audit flows')
    except Exception:
        for name,page in [('host',host),('player',player)]:
            try:
                shot(page,'failure-'+name+'.png')
                (out/('failure-'+name+'.txt')).write_text(page.locator('body').inner_text())
            except Exception:
                pass
        raise
    finally:
        browser.close()
(out/'acceptance.json').write_text(json.dumps({'checks':checks,'browserErrors':errors},ensure_ascii=False,indent=2))
print(f'Completed {len(checks)} new-feature browser checks.',flush=True)
