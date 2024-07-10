# BV-BRC User Service

## Overview

The BV-BRC User Service manages the BV-BRC user accounts. It provides REST endpoints for user registration, authentication, and maintenance.

## Usage

### Start
```
npm start

# in production
./node_modules/forever/bin/forever start -a -l /var/log/patric/prod/p3-user.log -o /var/log/patric/prod/p3-user.out -e /var/log/patric/prod/p3-user.err bin/p3-user
```

### API usage

#### Get Authentication Token
```
curl -X POST -H 'Content-Type:application/x-www-form-urlencoded' 'https://user.patricbrc.org/authenticate' \
 -d 'username=_USERNAME_' -d 'password=_PASSWORD_'
```

This will return a token like below,
```
un=_USERNAME_@patricbrc.org|tokenid=1c04a34e-d351-4a79-b24c-.....
```

#### Retrieve User Info with Auth Token
```
curl -H 'Accept:application/json' 'https://user.patricbrc.org/user/_USERNAME_' -H 'Authorization: _AUTH_TOKEN_'
```

#### Renew Auth Token
```
curl 'https://user.patricbrc.org/authenticate/refresh' -H 'Authorization: _AUTH_TOKEN_'
```

#### More routes
- register
- reset
- public_key

### Generating Signing Keypair:
```
openssl genrsa -out private.pem 2056
openssl rsa -in private.pem -pubout -out public.pem 
```

### Deploy with Singularity

These instructions describe how build a singularity container for p3_user and deploy it.  The process requires singularity and jq.

#### Build Singularity Container

```
./buildImage.sh
```
or
```
npm run build-image
```

These both generate a file with the name ```p3_user-<VERSION>.sif```.

#### Using the singularity container.

The deployment requires two folders, a configuration folder and a log folder.  One can be a child of the other if desired. To bootstrap the
run the following command:

```
singularity instance start --bind /PATH/TO/CONFIG/FOLDER:/config --bind /PATH/TO/LOG/FOLDER:/logs /path/to/p3_user-2.0.0.sif p3_user p3_user
```

NOTE: The last two parameters describe the singularity instance name.  The should both exist and they should ALWAYS be the same.

This command will start an instance of p3_user with a default config (that may fail to run). Additionally, it will populate the configuration 
a number of additional files.  The p3_user.conf and pm2.config.js files are the p3_user configuration file and a configuration file to tell pm2 
how to behave within the container.  Both of these may be edited and will not get replaced if they exist. An existing p3_user.conf should be
directly usable without changes in most cases. You may copy an existing p3_user.conf file into the configuration file before running the
above command, and it will use that from the start.  A number of shell scripts for controlling the application will be generated the first
time the command is run (or whenever start.sh doesn't exist).

	- start.sh  : Starts the singularity container and the process manager within
	- stop.sh   : Stops the process manager and the stops the container
	- restart.sh: Calls ./stop.sh && ./start.sh
	- reload.sh : Calls "reload" on the process manager.  This is for graceful reload after modifying the configuration file or for some other reason
	- scale.sh <desired instance count> : This modifies the number of running instances in the process manager to <desired instance count>
	- pm2.sh <pm2 arguments> : This is a simple wrapper around the pm2 process manager running inside the container
	- shell.sh  : This is simple wrapper around the shell command to connect to the instance
 
You will also note an instance.vars file.  This file contains variables pointing at the singularity image, instance name, and bind parameters
so that they won't need to be provided again.  Further, when an new image comes in,  modify instance.vars to point at the new image, stop the 
existing service (./stop.sh), and then run start.sh to start again with the new image.

#### Additional Notes

- The same image may be used for multiple configuration files.  Deploy an image to alpha (by pointing at the alpha configuration) and when all is good,
simply use the same image for beta and then production.
- A configuration folder must NOT be used by multiple instances concurrently.  The configuration folder holds the pm2 specifics for that instance and will
conflict if two instances use the same folder.
- Log folder can be shared between multiple applications provided that the log file names themselves are unique.




