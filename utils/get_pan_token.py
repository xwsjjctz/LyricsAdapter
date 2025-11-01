import http.client
import json
import os

from dotenv import load_dotenv

load_dotenv()

conn = http.client.HTTPSConnection("open-api.123pan.com")
payload = json.dumps({
    "clientID": os.environ.get("CLIENT_ID"),
    "clientSecret": os.environ.get("CLIENT_SECRET")
})
headers = {
    'Platform': 'open_platform',
    'Content-Type': 'application/json'
}
conn.request("POST", "/api/v1/access_token", payload, headers)
res = conn.getresponse()
data = res.read()
print(data.decode("utf-8"))