#!/vol/patric3/cli/ubuntu-runtime/bin/python3 

import pymongo
import json
import sys

if len(sys.argv) != 2:
    print(f"Usage: {sys.argv[0]} email-address", file=sys.stderr)
    sys.exit(1)

email = sys.argv[1]
conf = "/disks/p3/p3-user/BV-BRC-UserManagement/p3-user.conf"
cfg =json.load(open(conf))
url = cfg['mongo']['url']
#
# squelch pymongo warning
#
url = url.replace('&useUnifiedTopology=true', '');

cli = pymongo.MongoClient(url)
db = cli['p3-user']
col = db['user']
user = col.find_one({"email": email})

if user is None:
    print(f"User with email {email} not found", file=sys.stderr)
    sys.exit(1)

reset = user['resetCode']
if reset == '':
    print(f"Reset code for user {user['id']} and email {email} not found", file=sys.stderr)
    sys.exit(1)

reset = f"{cfg['siteURL']}/reset/{email}/{user['resetCode']}"
print(reset)
