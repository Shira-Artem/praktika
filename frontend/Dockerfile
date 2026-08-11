FROM node:22-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

ARG VITE_GAME_API_MODE=mock
ARG VITE_GAME_API_URL=""
ARG VITE_EVENT_API_URL=/events
ENV VITE_GAME_API_MODE=$VITE_GAME_API_MODE \
    VITE_GAME_API_URL=$VITE_GAME_API_URL \
    VITE_EVENT_API_URL=$VITE_EVENT_API_URL

RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
