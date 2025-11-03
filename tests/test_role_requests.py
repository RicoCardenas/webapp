def test_role_request_flow(client, session_token_factory, app, mail_outbox):
    previous = app.config.get('ROLE_REQUEST_RECIPIENTS')
    app.config['ROLE_REQUEST_RECIPIENTS'] = ['admin@ecuplot.test']
    try:
        token, user = session_token_factory()
        headers = {'Authorization': f'Bearer {token}'}

        res = client.post('/api/role-requests', headers=headers, json={'role': 'admin'})
        assert res.status_code == 201
        data = res.get_json()
        assert 'request_id' in data
        assert len(mail_outbox) == 1
        msg = mail_outbox[0]
        assert user.email in msg.body
        assert 'rol' in msg.subject.lower()

        status_res = client.get('/api/role-requests/me', headers=headers)
        assert status_res.status_code == 200
        status_payload = status_res.get_json()
        assert status_payload['request']['status'] == 'pending'
        assert status_payload['request']['requested_role'] == 'admin'

        duplicate = client.post('/api/role-requests', headers=headers, json={'role': 'admin'})
        assert duplicate.status_code == 409
    finally:
        if previous is None:
            app.config.pop('ROLE_REQUEST_RECIPIENTS', None)
        else:
            app.config['ROLE_REQUEST_RECIPIENTS'] = previous
