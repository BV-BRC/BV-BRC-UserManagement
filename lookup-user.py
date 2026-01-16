#!/vol/patric3/cli/ubuntu-runtime/bin/python3 

import pymongo
import json
import sys
import re
from bson.json_util import dumps

# Look up users. If no user supplied, read stdin for the list of users

users = sys.argv[1:]


if len(users) == 0:
    users = sys.stdin.readlines()
    users = [s.strip() for s in users]

users = [re.sub('@bvbrc$', '', s) for s in users]

conf = "/disks/p3/p3-user/BV-BRC-UserManagement/p3-user.conf"
cfg =json.load(open(conf))
url = cfg['mongo']['url']
#
# squelch pymongo warning
#
url = url.replace('&useUnifiedTopology=true', '');

cli = pymongo.MongoClient(url);
db = cli['p3-user']
col = db['user']

for id in users:
    #user = col.find_one({"l_id": id.lower()})
    user = col.find_one({"$or": [{"email": id}, {"l_id": id.lower()}]})


    if user is None:
        print(f"User {id} not found", file=sys.stderr)
        continue

    print(f"{user['id']}\t{user['email']}\t{user['first_name']}\t{user['last_name']}")
    print(dumps(user, indent=2))
