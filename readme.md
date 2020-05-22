# PATRIC User Service

## Start
```
npm start

# in production
./node_modules/forever/bin/forever start -a -l /var/log/patric/prod/p3-user.log -o /var/log/patric/prod/p3-user.out -e /var/log/patric/prod/p3-user.err bin/p3-user
```

## API usage

### Get Authentication Token
```
curl -X POST -H 'Content-Type:application/x-www-form-urlencoded' 'https://user.patricbrc.org/authenticate' \
 -d 'username=_USERNAME_' -d 'password=_PASSWORD_'
```

This will return a token like below,
```
un=_USERNAME_@patricbrc.org|tokenid=1c04a34e-d351-4a79-b24c-.....
```

### Retrieve User Info with Auth Token
```
curl -H 'Accept:application/json' 'https://user.patricbrc.org/user/_USERNAME_' -H 'Authorization: _AUTH_TOKEN_'
```

### Renew Auth Token
```
curl 'https://user.patricbrc.org/authenticate/refresh' -H 'Authorization: _AUTH_TOKEN_'
```

### More routes
- register
- reset
- public_key

## Generating Signing Keypair:
```
openssl genrsa -out private.pem 2056
openssl rsa -in private.pem -pubout -out public.pem 
```
