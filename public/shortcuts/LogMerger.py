import orjson
import os
import sys
import time


def merge_entries(data1, data2):

    data1Length = len(data1)
    data2Length = len(data2)

    # append entries in data2 that are not in data1 by ip
    

    if count_duplicates(data1):
        print("FOUND DUPLICATES IN FIRST DATA, EXITING")
        return
    if count_duplicates(data2):
        print("FOUND DUPLICATES IN SECOND DATA, EXITING")
        return

    uniqueItems = find_unique_ips(data1, data2)
    for item in uniqueItems:
        data1.append(item)

    ## TODO - merge unique trace data into the ips

    # checks

    print("Data1 Length:", data1Length)
    print("Data2 Length:", data2Length)
    print("Unique entries:", len(uniqueItems))
    print("Predicted merge length:", data1Length + len(uniqueItems))
    print("Merged Length:", len(data1))

    json_bytes = orjson.dumps({"geo_cache": data1})
    # Define the file path
    file_path = f"../../permDatabase/log_{time.strftime('%m-%d_%H-%M')}MERGED.json"
    # Open the file in write-binary mode and write the bytes
    try:
        with open(file_path, "wb") as f:
            f.write(json_bytes)
        print(f"Data successfully saved to {os.path.abspath(file_path)}")
    except IOError as e:
        print(f"An error occurred while writing to the file: {e}")




def is_same(data1,data2):
    for idx1, item1 in enumerate(data1):
        for idx2, item2 in enumerate(data2):
            if item1 == item2:
                print(
                    "found same | "
                    + item1["ip"]
                    + "At Index: "
                    + str(idx1)
                    + " | "
                    + item2["ip"]
                    + "At Index: "
                    + str(idx2)
                )
            

def count_similar_entries(data1, data2):
    for idx1, item1 in enumerate(data1):
        for idx2, item2 in enumerate(data2):
            if item1["ip"] == item2["ip"]:
                print(
                    "found similar | "
                    + item1["ip"]
                    + "At Index: "
                    + str(idx1)
                    + " | "
                    + item2["ip"]
                    + "At Index: "
                    + str(idx2)
                )


def find_unique_ips(data1, data2):
    uniqueEntries = []

    for item2 in data2:
        if item2 not in data1:
            uniqueEntries.append(item2)
    return uniqueEntries


def count_duplicates(data):
    duplicate_found = False
    for idx1, item1 in enumerate(data):
        for idx2, item2 in enumerate(data):
            if item1["ip"] == item2["ip"] and idx1 != idx2:
                duplicate_found = True
                print(
                    "Duplicate Found | "
                    + item1["ip"]
                    + "At Index: "
                    + str(idx1)
                    + " | "
                    + item2["ip"]
                    + "At Index: "
                    + str(idx2)
                )
    not duplicate_found and print("No duplicates found!")


def get_avg2(num1, num2):
    return (num1 + num2) / 2


def main():
    if len(sys.argv) == 3:
        file1 = sys.argv[1]
        file2 = sys.argv[2]
        print(
            "=" * 30
            + " Merging "
            + os.path.basename(file1)
            + " with "
            + os.path.basename(file2)
            + " "
            + "=" * 30
        )
        print("File 1: ", file1)
        print("File 2: ", file2)

        try:
            with open(file1, "rb") as f:
                file1Bytes = f.read()
            file1Data = orjson.loads(file1Bytes)

            with open(file2, "rb") as f:
                file2Bytes = f.read()
            file2Data = orjson.loads(file2Bytes)

            print("Successfully imported data:")

        except FileNotFoundError:
            print(f"Error: The file '{file1}' was not found.")
        except orjson.JSONDecodeError as e:
            print(f"Error decoding JSON: {e}")
        except Exception as e:
            print(f"An unexpected error occurred: {e}")

        merge_entries(file1Data["geo_cache"], file2Data["geo_cache"])
        
        # is_same(file1Data["geo_cache"], file2Data["geo_cache"])

        # find_unique_ips(file1Data["geo_cache"],file2Data["geo_cache"])
        print("=" * 90)
    else:
        print(
            "Please provide 2 arguments, location to first file and location to second file"
        )


if __name__ == "__main__":
    main()
