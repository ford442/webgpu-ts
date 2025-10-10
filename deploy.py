import os
import paramiko
import getpass

HOSTNAME = "1ink.us"
PORT = 22  # Default SFTP/SSH port
USERNAME = "ford442"

LOCAL_DIRECTORY = "build"
REMOTE_DIRECTORY = "test.1ink.us/webgputs"

def upload_directory(sftp_client, local_path, remote_path):
    print(f"Creating remote directory: {remote_path}")
    try:
        sftp_client.mkdir(remote_path)
    except IOError:
        print(f"Directory {remote_path} already exists.")
    for item in os.listdir(local_path):
        local_item_path = os.path.join(local_path, item)
        remote_item_path = f"{remote_path}/{item}"
        if os.path.isfile(local_item_path):
            print(f"Uploading file: {local_item_path} -> {remote_item_path}")
            sftp_client.put(local_item_path, remote_item_path)
        elif os.path.isdir(local_item_path):
            upload_directory(sftp_client, local_item_path, remote_item_path)

def main():
    password = 'GoogleBez12!' # getpass.getpass(f"Enter password for {USERNAME}@{HOSTNAME}: ")
    transport = None
    sftp = None
    try:
        transport = paramiko.Transport((HOSTNAME, PORT))
        print("Connecting to server...")
        transport.connect(username=USERNAME, password=password)
        print("Connection successful!")
        sftp = paramiko.SFTPClient.from_transport(transport)
        print(f"Starting upload of '{LOCAL_DIRECTORY}' to '{REMOTE_DIRECTORY}'...")
        upload_directory(sftp, LOCAL_DIRECTORY, REMOTE_DIRECTORY)
        print("\n✅ Deployment complete!")
    except Exception as e:
        print(f"❌ An error occurred: {e}")
    finally:
        # Ensure the connection is closed
        if sftp:
            sftp.close()
        if transport:
            transport.close()
        print("Connection closed.")

if __name__ == "__main__":
    if not os.path.exists(LOCAL_DIRECTORY):
        print(f"Error: Local directory '{LOCAL_DIRECTORY}' not found. Did you run 'npm run build' first?")
    else:
        main()
