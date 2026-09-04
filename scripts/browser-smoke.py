import json
import os
from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get('SMOKE_BASE_URL', 'http://127.0.0.1:4173')
network = []
console_errors = []
page_errors = []

SESSION_RESPONSE = {
    'MessageCode': 200,
    'result': {
        'key_value': 'smoke-token',
        'user_info': {
            'bms_url': 'http://bms.smoke.test',
            'bms_session_code': 'smoke-token',
            'bms_database_type': 'PostgreSQL',
            'hospital_code': '10929',
            'location': 'Smoke Hospital',
        },
    },
}

CASE_ROW = {
    'an': '1001',
    'hn': '00***21',
    'ptname': 'นาย ป*** ม***',
    'sex': 'ชาย',
    'age': 68,
    'first_ward': '01',
    'first_ward_name': 'อายุรกรรมชาย',
    'last_ward': '01',
    'last_ward_name': 'อายุรกรรมชาย',
    'dchdate': '2026-08-07T14:30:00.000Z',
    'admdate': '2026-08-01T00:00:00.000Z',
    'los': 6,
    'dchtype': '1',
    'dchstts': '1',
    'drg': '04010',
    'mdc': '04',
    'rw': 0.985,
    'adjrw': 1.052,
    'pdx': 'J189',
    'sdx1': 'I10',
    'proc1': '9914',
    'pttype': '1',
    'pttype_name': 'บัตรทอง',
    'income': 18500,
    'remain_money': 0,
    'grouper_err': None,
}


def fulfill(route, payload):
    route.fulfill(
        status=200,
        content_type='application/json',
        body=json.dumps(payload, ensure_ascii=False),
    )


def handle_route(route):
    request = route.request
    url = request.url
    network.append({
        'url': url,
        'method': request.method,
        'body': request.post_data or '',
        'headers': request.headers,
    })

    if url.startswith('https://hosxp.net/phapi/PasteJSON'):
        fulfill(route, SESSION_RESPONSE)
        return

    if url.startswith('http://bms.smoke.test/api/sql'):
        sql = json.loads(request.post_data or '{}').get('sql', '')
        if 'total_adjrw' in sql:
            payload = {'MessageCode': 200, 'data': [{
                'total_count': 1,
                'uncoded_count': 0,
                'coded_count': 1,
                'total_adjrw': 1.052,
                'total_income': 18500,
            }]}
        elif 'COUNT(*)::int AS total_count' in sql:
            payload = {'MessageCode': 200, 'data': [{'total_count': 1}]}
        elif 'procedure_per_an' in sql:
            payload = {'MessageCode': 200, 'data': [CASE_ROW]}
        elif 'FROM opitemrece' in sql:
            payload = {'MessageCode': 200, 'data': [{
                'hos_guid': 'SMOKE-GUID-1',
                'an': '1001',
                'icode': '1500010',
                'item_name': 'Smoke evidence item',
                'need_order_reason': 'Severe sepsis A41.9',
                'presc_reason': 'A419',
                'sum_price': 1200,
                'qty': 1,
                'unitprice': 1200,
            }]}
        else:
            payload = {'MessageCode': 200, 'data': [CASE_ROW]}
        fulfill(route, payload)
        return

    if url.startswith('https://had-api.moph.go.th/cmi/drg/calculate'):
        fulfill(route, {'status': 200, 'data': [{
            'drg': '04010',
            'rw': 0.985,
            'adjrw': 1.052,
            'mdc': '04',
            'wtlos': 5.2,
            'ot': 8,
        }]})
        return

    if url.startswith(BASE_URL):
        route.continue_()
        return

    route.abort()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    page = context.new_page()
    page.on('pageerror', lambda error: page_errors.append(str(error)))
    page.on('console', lambda message: console_errors.append(message.text) if message.type == 'error' else None)
    page.route('**/*', handle_route)

    page.goto(f'{BASE_URL}/?bms-session-id=smoke', wait_until='networkidle')
    page.get_by_text('Smoke Hospital', exact=True).first.wait_for(timeout=10000)
    assert '/worklist' in page.url
    assert 'bms-session-id' not in page.url
    assert page.locator('tbody tr').count() == 1

    bms_requests = [item for item in network if 'bms.smoke.test/api/sql' in item['url']]
    assert len(bms_requests) == 3
    assert all(item['headers'].get('authorization') == 'Bearer smoke-token' for item in bms_requests)
    assert all('target_cases' in item['body'] for item in bms_requests)
    assert all('"dstart"' in item['body'] and '"dend"' in item['body'] for item in bms_requests)
    assert page.evaluate('({local: Object.keys(localStorage), session: Object.keys(sessionStorage)})') == {'local': [], 'session': []}

    search = page.get_by_label('ค้นหาเคส')
    search.fill('1001')
    page.wait_for_timeout(100)
    assert len([item for item in network if 'bms.smoke.test/api/sql' in item['url']]) == 3
    page.wait_for_timeout(400)
    assert len([item for item in network if 'bms.smoke.test/api/sql' in item['url']]) == 6

    for width in (1440, 1024, 768, 375, 320):
        page.set_viewport_size({'width': width, 'height': 1000})
        page.wait_for_timeout(80)
        assert page.evaluate('document.documentElement.scrollWidth') <= page.evaluate('window.innerWidth')

    page.set_viewport_size({'width': 1440, 'height': 1000})
    page.get_by_role('button', name='วิเคราะห์เคส AN 1001').click()
    page.wait_for_url('**/optimizer/1001', timeout=10000)
    page.get_by_text('CASE 1001', exact=True).wait_for(timeout=10000)
    page.get_by_text('Usage ที่ใช้ประกอบ', exact=True).wait_for(timeout=10000)
    page.reload(wait_until='networkidle')
    page.get_by_text('CASE 1001', exact=True).wait_for(timeout=10000)
    page.set_viewport_size({'width': 375, 'height': 1000})
    page.wait_for_timeout(100)
    assert page.evaluate('document.documentElement.scrollWidth') <= page.evaluate('window.innerWidth')

    assert not any('cors' in item['url'].lower() or 'proxy' in item['url'].lower() for item in network)
    assert not console_errors, console_errors
    assert not page_errors, page_errors
    print(json.dumps({'status': 'passed', 'bms_sql_requests': len([item for item in network if 'bms.smoke.test/api/sql' in item['url']]), 'console_errors': 0, 'page_errors': 0}))
    browser.close()
