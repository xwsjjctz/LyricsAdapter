from flask import Flask, jsonify
from utils import qq_music_metadata, qq_music_resource

app = Flask(__name__)

@app.route('/', methods=['GET'])
def radio_station_recommendation():
    pass

@app.route('/search', methods=['GET'])
def search_music():
    pass

@app.route('/download', methods=['GET'])
def download_music():
    pass