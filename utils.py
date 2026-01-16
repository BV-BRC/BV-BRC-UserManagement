
import pymongo
import json
import sys
import smtplib
from email.message import EmailMessage

conf = "/disks/p3/p3-user/BV-BRC-UserManagement/p3-user.conf"
cfg =json.load(open(conf))
url = cfg['mongo']['url']
#
# squelch pymongo warning
#
url = url.replace('&useUnifiedTopology=true', '');

def lookup_user_by_email(email):
    cli = pymongo.MongoClient(url)
    db = cli['p3-user']
    col = db['user']
    user = col.find_one({"email": email})

    if user is None:
        print(f"User with email {email} not found", file=sys.stderr)
        sys.exit(1)

    return user

def get_reset_url(email):
    user = lookup_user_by_email(email)
    reset = user['resetCode']
    if reset == '':
        print(f"Reset code for user {user['id']} and email {email} not found", file=sys.stderr)
        sys.exit(1)

    reset = f"{cfg['siteURL']}/reset/{email}/{user['resetCode']}"
    return reset

def send_email(to_address, subject, body_text, body_html):
    # Configure your email credentials
    smtp_server = 'localhost'
    smtp_port = 25
    from_address = 'help@bv-brc.org'

    # Build the message
    msg = EmailMessage()
    msg['From'] = from_address
    msg['To'] = to_address
    msg['Subject'] = subject

    # Add plain text and HTML versions
    msg.set_content(body_text)
    msg.add_alternative(body_html, subtype='html')
    print(msg)

    # Send it
    try:
        with smtplib.SMTP(smtp_server, smtp_port) as server:
            server.send_message(msg)
        print("Email sent successfully.")
    except Exception as e:
        print(f"Failed to send email: {e}")
