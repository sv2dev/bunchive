#!/bin/sh

ln -fnf /usr/share/zoneinfo/$TZ /etc/localtime
echo $TZ > /etc/timezone

bun bunchive.js "$@"
