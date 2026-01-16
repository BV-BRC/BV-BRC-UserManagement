#!/vol/patric3/cli/ubuntu-runtime/bin/python3

import pymongo
import json
import sys
import re

# Look up users. If no user supplied, read stdin for the list of users

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

count = col.count_documents({"password": { "$ne":  None}})
print(f"User count {count}")
