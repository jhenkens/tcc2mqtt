FROM node:18-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY ["package.json", "package-lock.json*", "./"]
RUN apk add --no-cache --virtual .gyp \
        python3 \
        make \
        g++ \
    && npm install --omit=dev \
    && apk del .gyp

COPY "lib" "./lib"
COPY ["config.js", "mqtt.js", "./"]

CMD [ "node", "mqtt.js" ]
