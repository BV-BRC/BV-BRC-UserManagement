#!/vol/patric3/cli/ubuntu-runtime/bin/python3 

import utils
import sys

if len(sys.argv) != 2:
    print(f"Usage: {sys.argv[0]} email-address", file=sys.stderr)
    sys.exit(1)

email = sys.argv[1]

reset_url = utils.get_reset_url(email)

#email="bob@rdolson.org"
#email="olson@mcs.anl.gov"
if reset_url is not None and reset_url != "":
    utils.send_email(email, "BV-BRC account reset",
            f"The reset URL for your password reset is:\n\t{reset_url}\n",
            f"The reset URL for your password reset is:<br>&nbsp;&nbsp;&nbsp;&nbsp;<a href=\"{reset_url}\">{reset_url}</a>\n")
