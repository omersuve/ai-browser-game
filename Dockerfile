# Use the official Node.js image
FROM node:22-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Set environment variable for timezone
ENV TZ=UTC

# Copy the application code
COPY . .

# Build the application
RUN npm run build

# Command to run the application
CMD ["npm", "run", "start"]
