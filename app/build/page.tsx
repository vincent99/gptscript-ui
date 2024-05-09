"use client";

import React, { useCallback, useRef, useEffect, useState } from 'react';
import { 
    Card,
    CardHeader,
    CardBody,
    CardFooter,
 } from '@nextui-org/react';
import ScriptNav from './components/scriptNav';
import CustomTool from './components/tool';
import { useSearchParams } from 'next/navigation';
import 'reactflow/dist/style.css';
import type { Tool } from '@gptscript-ai/gptscript';
import { debounce } from 'lodash';
import ReactFlow, {
    useNodesState,
    useEdgesState,
    addEdge,
    useReactFlow,
    ReactFlowProvider,
    Background,
    type Node as RFNode,
    type Edge as RFEdge,
    Panel,
} from 'reactflow';

const nodeTypes = {
    customTool: CustomTool,
};

const fetchGraph = async (file: string | null) => {
    if (!file) return { nodes: [], edges: [] };
    const response = await fetch(`http://localhost:3000/api/file/${file}?nodeify=true`);
    const data = await response.json();
    const nodes = data.nodes as RFNode[];
    const edges = data.edges as RFEdge[];
    return { nodes, edges };
};

const AddNodeOnEdgeDrop = () => {
    const file = useSearchParams().get('file');
    const reactFlowWrapper = useRef(null);
    const connectingNodeId = useRef(null);
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const { screenToFlowPosition } = useReactFlow();

    // Call a debounced post to update the script with the new nodes every second.
    const updateScript = useCallback(debounce(async (nodes: RFNode[]) => {
        await fetch(`http://localhost:3000/api/file/${file}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(nodes),
        });
    }, 1000),[]);

    // Create a new file if the file param is 'new'
    useEffect(() => {
        if (file === 'new') {
            fetch(`http://localhost:3000/api/file`, { method: 'POST' })
                .then((response) => response.json())
                .then((data: any) => {
                    window.location.href = `/build?file=${data.file.replace('.gpt', '')}`;
                });
        }
    }, []);

    // Fetch the graph data for this file
    useEffect(() => {
        fetchGraph(file).then((graph) => {
            setEdges(graph.edges);
            setNodes(graph.nodes);
        });
    }, []);

    // Call the updateScript function when the user changes a node's data
    useEffect(() => {
        const handleEvent = (_: Event) => updateScript(nodes);
        window.addEventListener('newNodeData', handleEvent);
        return () => window.removeEventListener('newNodeData', handleEvent);
    }, [nodes]);

    // Generate a unique id for a new node based on the existing nodes
    const getId = (): string => {
        let id = 1;
        while (nodes.some((node) => node.id === `new-tool-${id}`)) {
            id++;
        }
        return `${id}`;
    };

    // When a connection is made between two nodes in the graph we want to update the script
    // to reflect the new connection. This involves adding the target tool to the source tool's
    // tools array and updating the script with the new nodes.
    const onConnect = useCallback(
        (params: any) => {
            params.animated = true;
            connectingNodeId.current = null;

            const sourceNode = nodes.find((node) => node.id === params.source)?.data as Tool;
            const targetNode = nodes.find((node) => node.id === params.target)?.data as Tool;

            if (!sourceNode?.tools) sourceNode.tools = [];
            if (!sourceNode?.tools?.includes(targetNode.name)) {
                sourceNode.tools.push(targetNode.name);
            }
            setNodes((nds) => {
                const newNodes = nds.map((node) => {
                    if (node.id === sourceNode?.name) node.data = sourceNode;
                    return node;
                });
                updateScript(newNodes);
                return newNodes;
            });
            setEdges((eds) => addEdge(params, eds));
        },
        [nodes]
    );

    // When a connection between two nodes is deleted we want to remove the target tool from the
    // source tool's tools array and update the script with the new nodes.
    const onEdgesDelete = useCallback((removedEdges: RFEdge[]) => {
        removedEdges.forEach((removedEdge) => {
            const sourceNode = nodes.find((node) => node.id === removedEdge.source)?.data as Tool;
            const targetNode = nodes.find((node) => node.id === removedEdge.target)?.data as Tool;
            if (sourceNode?.tools) {
                const index = sourceNode.tools.indexOf(targetNode?.name);
                if (index !== -1) {
                    sourceNode.tools.splice(index, 1);
                }
            }
        });
        setNodes((nds) => {
            const newNodes = nds.map((node) => {
                const sourceNode = nodes.find((n) => n.id === node.id)?.data as Tool;
                if (sourceNode) {
                    node.data = sourceNode;
                }
                return node;
            });
            updateScript(newNodes);
            return newNodes;
        });
        setEdges((eds) => eds.filter((edge) => !removedEdges.some((removedEdge) => removedEdge.id === edge.id)));
    }, [nodes]);

    // When a connection is started we want to store the id of the node that is being connected
    const onConnectStart = useCallback((_: any, { nodeId }: any) => {
        connectingNodeId.current = nodeId;
    }, []);

    // When a connection is ended we want to check if the target of the connection is a node or the pane
    // If the target is the pane we want to create a new tool node and connect it to the source tool node.
    // If the target is a node we want to connect the source tool node to the target tool node.
    const onConnectEnd = useCallback(
        (event: any) => {
            if (!connectingNodeId.current) return;

            const targetIsPane = event.target.classList.contains('react-flow__pane');

            if (targetIsPane) {
                const sourceNode = nodes.find((node) => node.id === connectingNodeId.current);
                const id = `new-tool-${getId()}`;
                const newNode = {
                    id,
                    type: 'customTool',
                    position: screenToFlowPosition({x: event.clientX, y: event.clientY,}),
                    data: { name: id, type: 'tool'},
                    origin: [0.0, 0.0],
                };

                setNodes((nds) => {
                    const newNodes = nds.concat(newNode);
                    newNodes.forEach((node) => {
                        if (node.id === connectingNodeId.current) {
                            if (!(sourceNode?.data as Tool)?.tools) (sourceNode?.data as Tool).tools = [];
                            if (!(sourceNode?.data as Tool)?.tools?.includes(newNode.id)) {
                                (sourceNode?.data as Tool).tools.push(newNode.id);
                            }
                            node.data = sourceNode?.data;
                        }
                    });
                    updateScript(newNodes);
                    return newNodes;
                });
                setEdges((eds) => (eds as any).concat({ id: newNode.id, source: connectingNodeId.current, target: newNode.id, animated: true }));
            }
        },
        [screenToFlowPosition, nodes]
    );

    // When a node is dragged we want to update the script with the new node positions.
    const onNodeDragStop = useCallback((_event: any, _node: any) => updateScript(nodes), [nodes]);

    // When a node is deleted we want to update the script with the remaining nodes.
    const onNodeDelete = useCallback((removedNodes: RFNode[]) => {
        const newNodes: RFNode[] = (nodes as RFNode[]).filter((node) => {
            return !removedNodes.find((removedNode) => removedNode.id === node.id);
        });
        updateScript(newNodes);
    }, [nodes]);

    return (
        <div className="w-full h-full" ref={reactFlowWrapper}>
            <ReactFlow
                nodeTypes={nodeTypes}
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodesDelete={onNodeDelete}
                onConnect={onConnect}
                onConnectStart={onConnectStart}
                onConnectEnd={onConnectEnd}
                onNodeDragStop={onNodeDragStop}
                onEdgesDelete={onEdgesDelete}
                maxZoom={0.9}
                nodeOrigin={[0.0, 0.5]}
                fitView
                
            >
                <Panel position="top-left">
                    <ScriptNav />
                </Panel>
                {/* <Panel position="top-right">
                    {infoPanel && (
                        <Card className="w-[400px]" style={{ height: 'calc(100vh - 100px)' }}>
                            {infoPanel}
                        </Card>
                    )}            
                </Panel> */}
                <Background />
            </ReactFlow>
        </div>
    );
};

export default () => (
    <ReactFlowProvider>
        <AddNodeOnEdgeDrop />
    </ReactFlowProvider>
);