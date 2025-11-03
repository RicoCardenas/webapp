def test_contact_form_submit_success(client, mail_outbox):
    response = client.post(
        "/contact",
        data={
            "name": "Juan Perez",
            "email": "juan@example.com",
            "message": "Hola, me interesa conocer más sobre EcuPlot.",
        },
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert response.headers["Location"].endswith("/contact/resultado?status=ok")

    follow = client.get(response.headers["Location"])
    assert follow.status_code == 200
    assert b"Mensaje enviado" in follow.data
    assert b"Gracias por escribirnos." in follow.data
    assert len(mail_outbox) in (0, 1)


def test_contact_form_submit_validation_error(client, mail_outbox):
    response = client.post(
        "/contact",
        data={
            "name": "J",
            "email": "nope",
            "message": "Hola",
        },
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert response.headers["Location"].endswith("/contact/resultado?status=error")
    assert len(mail_outbox) == 0

    follow = client.get(response.headers["Location"])
    assert follow.status_code == 400
    body = follow.data.decode("utf-8")
    assert "Revisa los campos" in body
    assert "Ingresa tu nombre" in body
    assert "Proporciona un correo válido" in body
